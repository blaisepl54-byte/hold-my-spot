// Inbound WhatsApp message parsing. P1, Build Order 4. PURE.
//
// A customer types free text into WhatsApp. This turns that into an intent, and
// nothing more: it opens nothing, decides nothing, and CANNOT resolve what the
// message means on its own.
//
// THE AMBIGUITY IS REAL AND IS DELIBERATELY NOT RESOLVED HERE.
// "YES" means two different things depending on state. It confirms a place in
// line if the customer is holding one, and it answers "did you get what you
// came for" if they have just been served and their survey is open. The parser
// cannot know which; only the caller, holding the entry, can. So the parser
// returns `affirmative` and the ORCHESTRATOR resolves it against state.
//
// Guessing here would be the worse design: a parser that assumed "yes always
// means confirm" would silently discard survey answers, and one that assumed
// the reverse would leave customers stuck unconfirmed while their reply was
// filed as satisfaction data.

export type InboundIntent =
  | { readonly kind: "join" }
  | { readonly kind: "affirmative" }
  | { readonly kind: "negative" }
  | { readonly kind: "wait_shorter" }
  | { readonly kind: "wait_as_expected" }
  | { readonly kind: "wait_longer" }
  | { readonly kind: "leave" }
  | { readonly kind: "unknown"; readonly text: string };

// Deliberately generous. A customer replying to a WhatsApp prompt types what
// feels natural, not a command, and a queue that only understands one spelling
// of "yes" is a queue that loses people. Every keyword below is matched on a
// normalised, punctuation-stripped string.
const JOIN = ["join", "start", "queue", "line", "hold my spot", "holdmyspot"];
// "ready" answers the call notification. It joins the affirmative set rather
// than becoming an intent of its own, because it is unambiguous in every state
// a customer can be in and a fourth meaning of "yes" would be a fourth thing
// the orchestrator has to disambiguate for no gain.
const YES = ["yes", "y", "yeah", "yep", "confirm", "confirmed", "ok", "okay", "1", "ready"];
const NO = ["no", "n", "nope", "2"];
const LEAVE = ["leave", "cancel", "stop", "exit", "remove me"];
const SHORTER = ["shorter", "short", "quick", "quicker", "faster"];
const AS_EXPECTED = ["about right", "as expected", "right", "expected", "fine", "ok wait"];
const LONGER = ["longer", "long", "slow", "slower", "too long"];

function normalise(body: string): string {
  return body
    .trim()
    .toLowerCase()
    // Strip punctuation and collapse whitespace, so "Yes!" and "yes" and " YES "
    // are one thing. Accents are left alone; they carry meaning in some names
    // and none of these keywords use them.
    .replace(/[.,!?;:'"()\[\]]/g, "")
    .replace(/\s+/g, " ");
}

export function parseInbound(body: string): InboundIntent {
  const text = normalise(body);
  if (text === "") return { kind: "unknown", text: body };

  // Order matters. The wait-expectation answers are checked BEFORE the yes/no
  // set, because "about right" contains "right" and a naive pass would strand
  // it. Longest, most specific match first.
  if (LONGER.some((k) => text === k || text.startsWith(k))) return { kind: "wait_longer" };
  if (AS_EXPECTED.some((k) => text === k || text.startsWith(k))) return { kind: "wait_as_expected" };
  if (SHORTER.some((k) => text === k || text.startsWith(k))) return { kind: "wait_shorter" };

  if (JOIN.some((k) => text === k || text.startsWith(`${k} `))) return { kind: "join" };
  if (LEAVE.some((k) => text === k || text.startsWith(`${k} `))) return { kind: "leave" };
  if (YES.includes(text)) return { kind: "affirmative" };
  if (NO.includes(text)) return { kind: "negative" };

  return { kind: "unknown", text: body };
}

// Twilio delivers the sender as `whatsapp:+18765550123`. The stored contact is
// the bare E.164 number, so the two must agree or no inbound message will ever
// find its entry.
export function normaliseSender(from: string): string {
  return from.replace(/^whatsapp:/i, "").trim();
}

// ---------------------------------------------------------------------------
// The survey reply, which is a DIFFERENT parse from the one above.
//
// SURVEY_QUESTIONS asks both questions in a SINGLE message, so a reply carries
// up to two answers at once ("yes, about right"). recordSurveyResponse writes
// both columns and responded_at in one statement, so it needs both. There is
// nowhere to park half an answer, and INVENTING THE MISSING HALF WOULD BE
// WORSE THAN LOSING IT: a fabricated "as_expected" is indistinguishable from an
// observed one in every rate the dashboard and the wait-time calibration
// compute from this table. So this returns each answer independently, `undefined`
// where the customer did not give one, and the caller records nothing until it
// holds both.
//
// THE DIGIT ALIASES ARE DELIBERATELY ABSENT HERE. parseInbound treats "1" as
// yes and "2" as no, which is right for a two-option prompt. In a survey reply
// they are question NUMBERS, because SURVEY_QUESTIONS writes "1)" and "2)", so
// "1 no 2 shorter" would be read as an affirmative by a parser that kept them.
// The customer said no.
// ---------------------------------------------------------------------------

export type WaitAnswer = "shorter" | "as_expected" | "longer";

export type SurveyReply = {
  readonly achieved: boolean | undefined;
  readonly waitMatch: WaitAnswer | undefined;
};

// THE SURVEY LISTS ARE NOT THE CONVERSATIONAL ONES, and the difference is not
// cosmetic. parseInbound matches on a PREFIX of the whole message; this matches
// whole words ANYWHERE in it, because a survey reply is a sentence rather than
// a command. Under that rule "expected" is a poisoned keyword: it appears in
// "shorter than expected" and "longer than expected", so a shared list reads
// both as as_expected and silently records the opposite of what was said. This
// was found by a test, not by reading.
const SURVEY_YES = ["yes", "y", "yeah", "yep", "yup", "got it"];
const SURVEY_NO = ["no", "n", "nope", "nah", "did not", "didnt"];
const SURVEY_LONGER = ["longer", "long", "slow", "slower"];
const SURVEY_AS_EXPECTED = ["about right", "as expected", "right", "same", "fine"];
const SURVEY_SHORTER = ["shorter", "short", "quick", "quicker", "fast", "faster"];

export function parseSurveyReply(body: string): SurveyReply {
  const text = normalise(body);
  const words = text === "" ? [] : text.split(" ");

  // Whole-word matching, not substring. "alright" must not answer the wait
  // question by containing "right", and a name or a thank-you must not be
  // mined for keywords it never meant.
  const has = (keyword: string): boolean =>
    keyword.includes(" ") ? text.includes(keyword) : words.includes(keyword);

  // Longest and most specific first, same reason as parseInbound.
  let waitMatch: WaitAnswer | undefined;
  if (SURVEY_LONGER.some(has)) waitMatch = "longer";
  else if (SURVEY_AS_EXPECTED.some(has)) waitMatch = "as_expected";
  else if (SURVEY_SHORTER.some(has)) waitMatch = "shorter";

  let achieved: boolean | undefined;
  if (SURVEY_YES.some(has)) achieved = true;
  else if (SURVEY_NO.some(has)) achieved = false;

  // "no longer" reads here as no, and longer. In the survey's context that is
  // the two answers to the two questions, and it is the reading the numbered
  // prompt invites. The English idiom is a real ambiguity and is NOT resolved;
  // negation generally is not handled, so "not longer" also reads as longer.
  return { achieved, waitMatch };
}

// Twilio expects TwiML or an empty 200. An empty <Response/> means "received,
// send nothing back", which is the ONLY response this system gives: every reply
// travels through the B5 transport adapter, so there is exactly one outbound
// path. Rendering message bodies into the webhook response would create a
// second one that the simulated surface cannot see and no test of the adapter
// covers.
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

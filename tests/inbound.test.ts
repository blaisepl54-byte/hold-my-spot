// Inbound message parsing tests. PURE.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_TWIML,
  normaliseSender,
  parseInbound,
  parseSurveyReply,
} from "../src/tools/whatsapp/inbound.ts";

const kind = (s: string): string => parseInbound(s).kind;

test("a customer joins in the words they would actually type", () => {
  for (const s of ["join", "JOIN", " Join ", "join the queue", "start", "hold my spot"]) {
    assert.equal(kind(s), "join", `"${s}" should join`);
  }
});

test("affirmative is recognised in its common spellings", () => {
  for (const s of ["yes", "Yes!", "y", "yeah", "confirm", "OK", "1"]) {
    assert.equal(kind(s), "affirmative", `"${s}" should be affirmative`);
  }
});

test("negative is recognised", () => {
  for (const s of ["no", "No.", "n", "nope", "2"]) {
    assert.equal(kind(s), "negative", `"${s}" should be negative`);
  }
});

test("the wait answers are distinguished from each other", () => {
  assert.equal(kind("shorter"), "wait_shorter");
  assert.equal(kind("longer than expected"), "wait_longer");
  assert.equal(kind("about right"), "wait_as_expected");
});

test('"about right" is NOT swallowed by a naive match on "right"', () => {
  // The specific ordering bug this parser is written to avoid: the survey's
  // middle answer contains a word that a looser rule would catch elsewhere.
  assert.equal(kind("about right"), "wait_as_expected");
  assert.equal(kind("right"), "wait_as_expected");
});

test("leaving is recognised, because a customer must be able to leave by reply", () => {
  for (const s of ["leave", "cancel", "STOP"]) {
    assert.equal(kind(s), "leave", `"${s}" should leave`);
  }
});

test("anything unrecognised is UNKNOWN and carries the original text", () => {
  const result = parseInbound("what time do you close?");
  assert.equal(result.kind, "unknown");
  if (result.kind !== "unknown") return;
  assert.equal(result.text, "what time do you close?", "the original is preserved, not the normalised form");
});

test("an empty message is unknown rather than accidentally matching", () => {
  assert.equal(kind(""), "unknown");
  assert.equal(kind("   "), "unknown");
});

test("AMBIGUITY IS PRESERVED: yes is affirmative, never resolved to confirm or survey", () => {
  // The parser cannot know which, because only the caller holds the entry.
  // Resolving here would silently discard survey answers or strand customers.
  assert.equal(kind("yes"), "affirmative");
});

test("the sender is normalised to the stored contact format", () => {
  assert.equal(normaliseSender("whatsapp:+18765550123"), "+18765550123");
  assert.equal(normaliseSender("WhatsApp:+18765550123"), "+18765550123");
  assert.equal(normaliseSender("+18765550123"), "+18765550123");
});

test("the empty response is well formed", () => {
  assert.ok(EMPTY_TWIML.startsWith("<?xml"));
  assert.ok(EMPTY_TWIML.includes("<Response>"));
});

// ---------------------------------------------------------------------------
// parseSurveyReply. SURVEY_QUESTIONS asks both questions in one message, so
// these assert that both answers come out of one reply, and that a partial
// reply stays partial rather than being completed by the parser.
// ---------------------------------------------------------------------------

test("both answers are extracted from one natural reply", () => {
  const cases: [string, boolean, string][] = [
    ["yes, about right", true, "as_expected"],
    ["YES LONGER", true, "longer"],
    ["no, shorter than expected", false, "shorter"],
    ["yeah it was quicker", true, "shorter"],
    ["nope, too long", false, "longer"],
  ];
  for (const [body, achieved, waitMatch] of cases) {
    const parsed = parseSurveyReply(body);
    assert.equal(parsed.achieved, achieved, `achieved for "${body}"`);
    assert.equal(parsed.waitMatch, waitMatch, `waitMatch for "${body}"`);
  }
});

test("HALF AN ANSWER STAYS HALF, so the caller cannot record a fabricated other half", () => {
  const onlyAchieved = parseSurveyReply("yes");
  assert.equal(onlyAchieved.achieved, true);
  assert.equal(onlyAchieved.waitMatch, undefined, "no wait answer was given, so none is invented");

  const onlyWait = parseSurveyReply("about right");
  assert.equal(onlyWait.waitMatch, "as_expected");
  assert.equal(onlyWait.achieved, undefined, "no satisfaction answer was given, so none is invented");

  const neither = parseSurveyReply("thanks!");
  assert.equal(neither.achieved, undefined);
  assert.equal(neither.waitMatch, undefined);
});

test("THE QUESTION NUMBERS ARE NOT READ AS ANSWERS", () => {
  // SURVEY_QUESTIONS writes "1)" and "2)". parseInbound treats "1" as yes and
  // "2" as no, which is right for a two-option prompt and CATASTROPHIC here: a
  // customer numbering their answers would have "no" overturned into "yes".
  assert.equal(parseInbound("1").kind, "affirmative", "the conversational parser still reads digits");

  const numbered = parseSurveyReply("1 no 2 shorter");
  assert.equal(numbered.achieved, false, "the customer said no; the leading 1 is a question number");
  assert.equal(numbered.waitMatch, "shorter");
});

test("keywords match whole words, so ordinary text is not mined for answers", () => {
  // "alright" contains "right". A parser matching substrings would answer the
  // wait question on a message that never mentioned the wait.
  const alright = parseSurveyReply("alright then");
  assert.equal(alright.waitMatch, undefined, '"alright" must not be read as "about right"');
  assert.equal(alright.achieved, undefined);
});

test("an empty body yields no answers rather than defaults", () => {
  const empty = parseSurveyReply("   ");
  assert.equal(empty.achieved, undefined);
  assert.equal(empty.waitMatch, undefined);
});

// --- the call response window ---------------------------------------------

test("READY parses as affirmative, in any case, with punctuation", () => {
  for (const body of ["READY", "ready", "Ready!", " ready "]) {
    assert.deepEqual(parseInbound(body), { kind: "affirmative" });
  }
});

test("NO still parses as negative and is not swallowed by the name branch", () => {
  assert.deepEqual(parseInbound("no"), { kind: "negative" });
  assert.deepEqual(parseInbound("Nope"), { kind: "negative" });
});

test("a real name is still unknown text, so name capture keeps working", () => {
  assert.deepEqual(parseInbound("Marcia Bennett"), {
    kind: "unknown",
    text: "Marcia Bennett",
  });
});

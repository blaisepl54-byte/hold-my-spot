// The HTTP surface. Health, plus B6's console routes.
//
// Reads go through persistence/read (hms_ro) and writes go through
// orchestrator/apply. This module opens NO pool of its own: improvising a
// second pool here is exactly the trap v4 section 1 exists to close (W3, and
// V4 before it), and it would also hand the console a connection capable of
// writing, which hms_ro deliberately is not.
//
// Every write route is a thin translation from HTTP to a named operation. No
// queue logic lives here. A route that needed to decide something would be a
// second place where fairness rules live, which is how they drift.

import express from "express";

import {
  callNext,
  checkIn,
  calledText,
  closeOfDay,
  completeText,
  completeService,
  deferEntry,
  DEFERRED_TEXT,
  notifyEntry,
  sweepCallDeadlines,
  confirmEntry,
  joinQueue,
  leaveQueue,
  markNoShow,
  estimateWaitFor,
  recordEntryName,
  recordEntryServiceType,
  recordSurveyResponse,
  removeProvisional,
  sendConfirmationPrompt,
  sendSurvey,
  SURVEY_QUESTIONS,
  undoCall,
  undoCheckIn,
} from "../orchestrator/apply/index.ts";
import type { WaitMatch } from "../orchestrator/apply/index.ts";
import {
  checkLiveness,
  readCounters,
  readDayTotals,
  readEntryByContact,
  readEvents,
  readLocations,
  readQueue,
  readServedToday,
  readServiceTypes,
  readSurveyStatus,
} from "../persistence/read/index.ts";
import type { Channel } from "../domain/index.ts";
import { SimulatedTransport } from "../tools/whatsapp/simulated.ts";
import type { Transport } from "../tools/whatsapp/index.ts";
import { TwilioTransport, twilioConfigFromEnv } from "../tools/whatsapp/twilio.ts";
import { EMPTY_TWIML, normaliseSender, parseInbound, parseServiceChoice, parseSurveyReply } from "../tools/whatsapp/inbound.ts";
import { publicWebhookUrl, validateTwilioSignature } from "../tools/whatsapp/signature.ts";
import { describeBasis, renderEstimate } from "../agents/wait-time.ts";
import { readAdherence, readDashboard } from "../persistence/read/dashboard.ts";
import { readAdminOverview } from "../persistence/read/admin.ts";
import { authConfigFromEnv, roleAtLeast, verifySessionToken } from "../auth/index.ts";
import type { Role, Session } from "../auth/index.ts";

// The console runs on the simulated surface, per King B's B5 choice: simulated
// first, Twilio behind it. This instance is shared so the phone view can read
// the same inbox the console wrote to.
const transport = new SimulatedTransport();

export function consoleTransport(): SimulatedTransport {
  return transport;
}

// P1. THE ONE PLACE THAT CHOOSES A TRANSPORT, and it chooses between the two
// adapters that already exist. No new transport path is created: B5's Twilio
// adapter is wired, not replaced, and the simulated surface stays the DEFAULT
// so neither becomes the only path. Twilio is opted into explicitly, because
// selecting it means messages reach real phones and that is not a default.
//
// Reading the config on every call rather than once at import is deliberate:
// it keeps this observable from a test that sets the environment, and an
// adapter whose selection cannot be exercised is an adapter nobody has checked.
function outboundTransport(): Transport {
  const config = twilioConfigFromEnv(process.env);
  if (process.env["HMS_TRANSPORT"] === "twilio" && config !== undefined) {
    return new TwilioTransport(config);
  }
  return transport;
}

// =====================================================================
// P2. The auth gate. ACTIVE WHEN CLERK_ISSUER IS SET, absent otherwise.
//
// The posture is stated plainly rather than implied: until the new console
// ships with Clerk's frontend, production does not set CLERK_ISSUER and these
// routes remain as open as they were before P2 — setting the variable is the
// act that turns enforcement on, and it is King B's, not a deploy side
// effect. Once set, EVERY staff route refuses an unauthenticated request with
// 401 and an under-ranked role with 403, on the server, from the signature.
//
// Customer surfaces are NEVER behind this: survey, survey-status and the
// Twilio webhook stay entry-scoped, because a person holding a place in line
// is never asked to create an account.
// =====================================================================
type Authed = express.Request & { session?: Session };

function requireRole(required: Role): express.RequestHandler {
  return (req: Authed, res, next) => {
    const config = authConfigFromEnv(process.env);
    if (config === undefined) {
      next();
      return;
    }
    const header = req.get("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token === "") {
      res.status(401).json({ ok: false, reason: "authentication required" });
      return;
    }
    void verifySessionToken(token, config).then((result) => {
      if (!result.ok) {
        res.status(401).json({ ok: false, reason: "authentication required" });
        return;
      }
      if (!roleAtLeast(result.session.role, required)) {
        res.status(403).json({ ok: false, reason: `requires ${required}` });
        return;
      }
      req.session = result.session;
      next();
    });
  };
}

const desk = requireRole("desk");
const manager = requireRole("manager");
const admin = requireRole("admin");

function isChannel(value: unknown): value is Channel {
  return value === "whatsapp" || value === "qr" || value === "reception";
}

// One shape for every write route. A failed operation is a 409 with its reason,
// never a 500: "you cannot call a served entry" is a legitimate answer to a
// well-formed request, not a server fault.
function send(res: express.Response, result: { ok: boolean; reason?: string; value?: unknown }): void {
  if (result.ok) {
    res.json({ ok: true, value: result.value });
  } else {
    res.status(409).json({ ok: false, reason: result.reason });
  }
}

// How many people are ahead, plus one. A COUNT, not an estimate, so it is exact
// and R-G does not apply to it: R-G governs how long a wait is claimed to be,
// not how many people can be seen standing in front of you.
//
// Counted over `waiting` only, matching countedForWaitMath: an unconfirmed
// entry holds its place but is not something to promise a customer they are
// behind, because it may never confirm.
async function positionOf(locationId: string, entryId: string): Promise<number> {
  const queue = await readQueue(locationId);
  const target = queue.find((e) => e.id === entryId);
  if (target === undefined) return 0;
  const ahead = queue.filter(
    (e) => e.status === "waiting" && e.joined_at < target.joined_at,
  ).length;
  return ahead + 1;
}

// The line a customer reads after they are placed or confirmed. One definition,
// because the position and the wait must agree with each other and with what
// the board shows, and three call sites composing it separately is how they
// stop agreeing.
async function placeLine(
  locationId: string,
  entryId: string,
  // Once a customer has said what they came for, the estimate is theirs rather
  // than the branch's average. The narrower bucket answers when it clears the
  // sample gate and falls back on its own when it does not, so passing this can
  // only make the number better informed, never less honest.
  serviceTypeId: string | null = null,
): Promise<string> {
  const position = await positionOf(locationId, entryId);
  const estimate = await estimateWaitFor({
    locationId,
    aheadInQueue: Math.max(0, position - 1),
    serviceTypeId,
  });
  return `You're number ${String(position)} in line. ${renderEstimate(estimate)}`;
}

// The menu, built from the branch's own live list. A branch that adds or
// retires a service changes this prompt without a deploy, which is what
// migration 005 made service types data for (R-I).
function serviceMenuText(name: string | null, labels: readonly string[]): string {
  const lines = labels.map((l, i) => `${String(i + 1)}. ${l}`).join("\n");
  return (
    `${name === null ? "Thanks" : `Thanks, ${name}`}. What are you here for today?\n` +
    `${lines}\n` +
    `Reply with the number.`
  );
}

const NAME_ASK =
  "Before we hold your place, what name should we put it under? " +
  "Please use the name on the ID you'll present at the counter.";

const CALL_WINDOW_NOTICE =
  "When we call you, you have 2 minutes to reply READY, or NO if you need more time - " +
  "then you move back one place, keeping your join time.";

export function createApp(): express.Express {
  const app = express();

  // =====================================================================
  // P3. CORS, restricted to the one configured origin. NOT WILDCARD, per the
  // order, and FAIL CLOSED: with CORS_ALLOWED_ORIGIN unset, no CORS header is
  // ever emitted and the API is same-origin only, which is exactly the state
  // it shipped in before P3. A wildcard here would let ANY page a staff member
  // has open drive the console's write routes with that member's network
  // position; the allow-list is one exact origin, compared with ===.
  //
  // Hand-rolled in ~20 lines rather than adding the `cors` package: this
  // project's supply chain is zero runtime dependencies beyond express and pg,
  // and a dependency that saves twenty readable lines does not pay for itself.
  // =====================================================================
  const allowedOrigin = process.env["CORS_ALLOWED_ORIGIN"] ?? "";
  app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (allowedOrigin !== "" && origin === allowedOrigin) {
      res.set("Access-Control-Allow-Origin", allowedOrigin);
      // The origin is echoed conditionally, so caches must key on it.
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      // Authorization listed EXPLICITLY: a Bearer token makes every request
      // non-simple, so the browser preflights asking for it, and a CORS layer
      // that only allows Content-Type silently kills the authenticated console
      // at the network layer. Found by the P2 frontend E2E, not by reading.
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      // Preflights are answered for the allowed origin and left bare for every
      // other, which the browser treats as a refusal. 204 either way: the
      // refusal is the ABSENCE of the header, per the CORS model, not a status.
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json());
  // P1. Twilio posts form-encoded, so this is required for the inbound webhook.
  // It must run BEFORE that route, because the signature is computed over the
  // parsed parameters.
  app.use(express.urlencoded({ extended: false }));

  // Reports ill health as well as good (v4 criterion 3): a database that is
  // down produces 503 and a differing body, not a hardcoded ok.
  app.get("/health", async (_req, res) => {
    const db = await checkLiveness();
    res.status(db.ok ? 200 : 503).json({
      process: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      database: db.ok ? "ok" : "unreachable",
      role: db.role,
      reason: db.reason,
    });
  });

  app.get("/api/locations", desk, async (_req, res) => {
    res.json({ ok: true, value: await readLocations() });
  });

  // The console's whole read model in one call, so the two sides cannot drift
  // by fetching at different moments.
  // C0. Counters and service types are DATA the console reads, not a hardcoded
  // array it ships. A counter typed into a form cannot be measured against.
  app.get("/api/counters", desk, async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    res.json({ ok: true, value: await readCounters(locationId) });
  });

  app.get("/api/service-types", desk, async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    // `provisional` is returned by the API rather than hardcoded in the client,
    // so every surface that renders this list gets the disclaimer with the data
    // and cannot forget it. R-I: the real list comes from rung 2.
    res.json({
      ok: true,
      value: await readServiceTypes(locationId),
      provisional: true,
      provisionalNote:
        "Placeholder service types pending rung 2 branch interviews. Data, not schema.",
    });
  });

  // C4. The branch dashboard, as JSON. RENDERED CLIENT SIDE, not server-rendered
  // HTML: per the order this is "the single decision that makes Phase 5 a deploy
  // rather than a rewrite", because a client of an API only changes its base
  // URL while a server-rendered page has to be rebuilt to sit on Netlify.
  app.get("/api/dashboard", manager, async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    const rawWindow = Number(req.query["windowDays"] ?? "30");
    const windowDays = Number.isFinite(rawWindow) && rawWindow > 0 && rawWindow <= 365
      ? Math.floor(rawWindow)
      : 30;
    res.json({ ok: true, value: await readDashboard(locationId, windowDays) });
  });

  // C5. Adherence, read-only. REPORTS, DOES NOT ACT: this endpoint returns
  // figures and findings and offers no action, no routing proposal and no
  // ranking. The posture travels in the payload's own notes.
  app.get("/api/adherence", manager, async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    const rawWindow = Number(req.query["windowDays"] ?? "30");
    const windowDays = Number.isFinite(rawWindow) && rawWindow > 0 && rawWindow <= 365
      ? Math.floor(rawWindow)
      : 30;
    res.json({ ok: true, value: await readAdherence(locationId, windowDays) });
  });

  app.get("/api/board", desk, async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    // LAZY EXPIRY, before the read. There is no scheduler in this codebase and
    // this does not add one: the deadline is evaluated whenever somebody looks
    // at the branch, and the desk console's poll is what looks. A write inside
    // a GET is unusual and is called out rather than slipped in; it is
    // conditional on the row still being `called`, so a check-in landing in the
    // same instant wins and this becomes a no-op.
    await sweepCallDeadlines({ locationId, transport: outboundTransport() });

    const [queue, totals, events] = await Promise.all([
      readQueue(locationId),
      readDayTotals(locationId),
      readEvents(locationId, 20),
    ]);

    // C3. The estimate for a customer joining now: everyone currently waiting
    // is ahead of them. Rendered here so the console shows the SAME words the
    // customer receives, and carries its basis so the number's provenance is
    // visible rather than implied.
    const ahead = queue.filter((e) => e.status === "waiting").length;
    const estimate = await estimateWaitFor({ locationId, aheadInQueue: ahead });
    res.json({
      ok: true,
      value: {
        queue,
        totals,
        events,
        estimate: {
          text: renderEstimate(estimate),
          basis: describeBasis(estimate),
          kind: estimate.kind,
        },
      },
    });
  });

  // The customer's phone view: the messages the simulated surface holds for
  // one entry. This is what makes the phone side real rather than a mock.
  app.get("/api/inbox", desk, (req, res) => {
    const entryId = String(req.query["entryId"] ?? "");
    res.json({ ok: true, value: transport.inbox(entryId === "" ? undefined : entryId) });
  });

  app.post("/api/join", desk, async (req, res) => {
    const body = req.body as {
      locationId?: string; channel?: string; contact?: string; name?: string; serviceTypeId?: string;
    };
    if (typeof body.locationId !== "string" || !isChannel(body.channel)) {
      res.status(400).json({ ok: false, reason: "locationId and a valid channel are required" });
      return;
    }
    // C4. Estimate BEFORE joining, so the stored prediction is the one this
    // customer was actually given rather than one recomputed after the queue
    // changed underneath them.
    const waitingNow = (await readQueue(body.locationId)).filter((e) => e.status === "waiting").length;
    const atJoin = await estimateWaitFor({ locationId: body.locationId, aheadInQueue: waitingNow });

    const result = await joinQueue({
      locationId: body.locationId,
      channel: body.channel,
      contact: body.contact ?? null,
      // FE-001. Reception captures the name at the desk. Trimmed and bounded
      // in the orchestrator's insert path identically to recordEntryName.
      name: typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim().slice(0, 80) : null,
      serviceTypeId: typeof body.serviceTypeId === "string" && body.serviceTypeId !== "" ? body.serviceTypeId : null,
      actor: body.channel === "whatsapp" ? "customer" : "reception",
      predictedLowMinutes: atJoin.kind === "estimate" ? atJoin.lowMinutes : null,
      predictedHighMinutes: atJoin.kind === "estimate" ? atJoin.highMinutes : null,
    });

    // A remote join gets its confirmation prompt immediately. On-site channels
    // are auto-confirmed by presence and need none.
    if (result.ok && body.channel === "whatsapp" && typeof body.contact === "string") {
      // R-G: the confirmation carries a RANGE or the honest string, never a
      // point value. renderEstimate owns both wordings so a caller cannot
      // soften the refusal into a number.
      await sendConfirmationPrompt({
        entryId: result.value.entryId,
        locationId: body.locationId,
        // P1: through the selector, so a reception-side join for a WhatsApp
        // contact reaches the same phone the inbound route talks to.
        transport: outboundTransport(),
        body:
          "You are in the queue. Reply to confirm and hold your place in line. " +
          renderEstimate(atJoin),
      });
    }
    send(res, result);
  });

  app.post("/api/call-next", desk, async (req, res) => {
    const body = req.body as { locationId?: string; counter?: string; actor?: string };
    if (typeof body.locationId !== "string") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    // Lazy expiry BEFORE selection, so a call that has already run out of time
    // has released its counter and its holder is stepped over rather than being
    // called a second time while still holding an expired call.
    await sweepCallDeadlines({ locationId: body.locationId, transport: outboundTransport() });

    const called = await callNext({
      locationId: body.locationId,
      actor: (req as Authed).session?.userId ?? body.actor ?? "operator",
      counter: body.counter ?? null,
    });
    // The notification is the point of this feature: before it, calling someone
    // told them nothing and they had to watch the board, which is the thing
    // this product exists to replace.
    if (called.ok && called.value.calledEntryId !== null) {
      await notifyEntry({
        entryId: called.value.calledEntryId,
        transport: outboundTransport(),
        compose: calledText,
      });
    }
    send(res, called);
  });

  // P2. The out-of-order override, I7's named approver. MANAGER-GATED, and the
  // approver written to the fairness log is the AUTHENTICATED identity when
  // auth is on — "the record of who authorised serving someone out of turn
  // stops being self declared", which the order names as the single largest
  // guarantee improvement in Phase 5. Pre-Clerk (issuer unset), the
  // client-supplied string is accepted as today's R13 convention: recorded,
  // not authenticated. The precedence makes the upgrade automatic the moment
  // enforcement turns on, with no route change.
  app.post("/api/call-entry", manager, async (req, res) => {
    const body = req.body as {
      locationId?: string; entryId?: string; counter?: string; approver?: string; reason?: string;
    };
    if (typeof body.locationId !== "string" || typeof body.entryId !== "string") {
      res.status(400).json({ ok: false, reason: "locationId and entryId are required" });
      return;
    }
    const session = (req as Authed).session;
    const called = await callNext({
      locationId: body.locationId,
      actor: session?.userId ?? "operator",
      approver: session?.userId ?? body.approver ?? null,
      outOfOrderEntryId: body.entryId,
      reason: typeof body.reason === "string" ? body.reason : null,
      counter: body.counter ?? null,
    });
    // An out-of-order call is still a call. The customer gets the same message
    // and the same two minutes; being called early does not make the response
    // window somebody else's problem.
    if (called.ok && called.value.calledEntryId !== null) {
      await notifyEntry({
        entryId: called.value.calledEntryId,
        transport: outboundTransport(),
        compose: calledText,
      });
    }
    send(res, called);
  });

  // P2/FE-001. The admin's cross-branch overview. ADMIN-GATED: it is the one
  // read that crosses branch boundaries. R-F holds here exactly as on the
  // dashboard: keyed on branch and counter, no employee named, nothing ranked
  // by person.
  app.get("/api/admin/overview", admin, async (_req, res) => {
    res.json({ ok: true, value: await readAdminOverview() });
  });

  // Entry-scoped verbs. Each names one operation; none of them decides anything.
  const entryRoutes: Record<
    string,
    (entryId: string, locationId: string, actor: string) => Promise<unknown>
  > = {
    confirm: (entryId, locationId, actor) => confirmEntry({ entryId, locationId, actor }),
    "check-in": (entryId, locationId, actor) => checkIn({ entryId, locationId, actor }),
    // C2. Completing a service sends the survey. Chosen NARROWLY: the order
    // says "after transition out of serving", and the other exits out of
    // serving are walk-out, no-show and undo-check-in. Asking "did you get what
    // you came for" of someone who left, was marked absent, or whose service is
    // resuming would produce data that reads like satisfaction and is not.
    // Flagged rather than silently narrowed; widen on a ruling.
    complete: async (entryId, locationId, actor) => {
      const done = await completeService({ entryId, locationId, actor });
      // P1: through the SELECTOR, not the simulated instance directly. A survey
      // that only ever reaches the simulated inbox cannot be answered from the
      // handset that was served.
      if (done.ok) {
        // The service closes BEFORE the survey opens. A survey arriving as the
        // first thing a customer hears after being served reads as an
        // interrogation; a line saying the visit is finished is what makes the
        // question that follows it a reasonable thing to ask.
        await notifyEntry({ entryId, transport: outboundTransport(), compose: completeText });
        await sendSurvey({ entryId, locationId, transport: outboundTransport() });
      }
      return done;
    },
    "no-show": (entryId, locationId, actor) => markNoShow({ entryId, locationId, actor }),
    "undo-call": (entryId, locationId, actor) => undoCall({ entryId, locationId, actor }),
    "undo-check-in": (entryId, locationId, actor) => undoCheckIn({ entryId, locationId, actor }),
    leave: (entryId, locationId, actor) =>
      leaveQueue({ entryId, locationId, actor, fromStatus: "waiting" }),
    remove: (entryId, locationId, actor) =>
      removeProvisional({ entryId, locationId, actor, reason: "operator removed a ghost entry" }),
  };

  for (const [verb, run] of Object.entries(entryRoutes)) {
    app.post(`/api/${verb}`, desk, async (req, res) => {
      const body = req.body as { entryId?: string; locationId?: string; actor?: string };
      if (typeof body.entryId !== "string" || typeof body.locationId !== "string") {
        res.status(400).json({ ok: false, reason: "entryId and locationId are required" });
        return;
      }
      const result = (await run(body.entryId, body.locationId, body.actor ?? "operator")) as {
        ok: boolean;
        reason?: string;
        value?: unknown;
      };
      send(res, result);
    });
  }

  // C2. The customer's two taps. Scoped by entryId, which the customer holds;
  // it needs no staff identity and Phase 5's Clerk gate must not require one,
  // because a customer answering a survey must never be asked to make an
  // account.
  // Whether this entry has an unanswered survey. Read-only, entry-scoped.
  // FE-001. Today's served list for the console, survey truth included, one
  // call. Desk-gated like every staff read.
  app.get("/api/served-today", desk, async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    res.json({ ok: true, value: await readServedToday(locationId) });
  });

  app.get("/api/survey-status", async (req, res) => {
    const entryId = String(req.query["entryId"] ?? "");
    if (entryId === "") {
      res.status(400).json({ ok: false, reason: "entryId is required" });
      return;
    }
    res.json({ ok: true, value: await readSurveyStatus(entryId) });
  });

  app.post("/api/survey", async (req, res) => {
    const body = req.body as {
      entryId?: string;
      locationId?: string;
      achieved?: unknown;
      waitMatch?: unknown;
    };
    const validMatch =
      body.waitMatch === "shorter" || body.waitMatch === "as_expected" || body.waitMatch === "longer";
    if (
      typeof body.entryId !== "string" ||
      typeof body.locationId !== "string" ||
      typeof body.achieved !== "boolean" ||
      !validMatch
    ) {
      res.status(400).json({
        ok: false,
        reason: "entryId, locationId, achieved (boolean) and waitMatch (shorter|as_expected|longer) are required",
      });
      return;
    }
    send(
      res,
      await recordSurveyResponse({
        entryId: body.entryId,
        locationId: body.locationId,
        achieved: body.achieved,
        waitMatch: body.waitMatch as WaitMatch,
      }),
    );
  });

  // =====================================================================
  // P1. The Twilio inbound webhook.
  //
  // THE SIGNATURE IS CHECKED BEFORE ANYTHING ELSE HAPPENS. Not after parsing
  // the intent, not after looking up the entry: a request that fails the check
  // must not cause so much as a database read. This URL is reachable by anyone
  // who finds it, and without the check a stranger could join as any phone
  // number, confirm someone else's place, answer their survey, or walk them out
  // of the queue. Every guarantee in this system is about WHO holds a place in
  // line, so an unauthenticated write here defeats the product rather than
  // merely being untidy.
  //
  // THE RESPONSE IS ALWAYS EMPTY. Replies go out through the B5 transport
  // adapter, the same one the console uses, so there is exactly one outbound
  // path. Putting message bodies in the webhook response would create a second
  // path that the simulated surface never sees.
  // =====================================================================
  app.post("/api/twilio/inbound", async (req, res) => {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.body as Record<string, unknown>)) {
      params[key] = typeof value === "string" ? value : String(value);
    }

    const check = validateTwilioSignature({
      authToken: process.env["TWILIO_AUTH_TOKEN"],
      signature: req.get("X-Twilio-Signature"),
      url: publicWebhookUrl(process.env),
      params,
    });

    if (!check.ok) {
      // The reason is logged, never returned. Telling a caller WHICH half of
      // the check failed is free reconnaissance: it distinguishes "the service
      // has no token" from "your signature was wrong", and the second answer
      // tells an attacker to keep trying.
      console.warn(`[twilio] inbound refused: ${check.reason}`);
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }

    const from = normaliseSender(String(params["From"] ?? ""));
    // The branch this number belongs to. NOT inferred from the message: a
    // system that guessed a location would put people in a queue at a branch
    // they never chose. Unset means this deployment cannot serve WhatsApp yet,
    // and the honest response is silence rather than a wrong branch.
    const locationId = process.env["HMS_DEFAULT_LOCATION_ID"] ?? "";
    if (from === "" || locationId === "") {
      res.status(200).type("text/xml").send(EMPTY_TWIML);
      return;
    }

    const existing = await readEntryByContact(locationId, from);
    const survey = existing === undefined
      ? { exists: false, open: false }
      : await readSurveyStatus(existing.id);

    let reply = "";

    if (existing !== undefined && survey.open) {
      // THE AMBIGUITY OF "YES" IS RESOLVED HERE, against state, because only
      // this layer holds the entry. With a survey open, YES answers the first
      // question; with a place being held, it confirms. The parser cannot know
      // which and deliberately does not guess.
      const answers = parseSurveyReply(String(params["Body"] ?? ""));
      if (answers.achieved !== undefined && answers.waitMatch !== undefined) {
        const recorded = await recordSurveyResponse({
          entryId: existing.id,
          locationId,
          achieved: answers.achieved,
          waitMatch: answers.waitMatch,
        });
        reply = recorded.ok
          ? "Thank you. Your answers are recorded."
          : "Thank you.";
      } else if (answers.achieved !== undefined) {
        // Half an answer is NOT written. There is nowhere to hold it, and
        // inventing the other half would put a satisfaction figure nobody gave
        // into the same column as the ones they did.
        reply = "Thanks. And how was the wait: SHORTER than expected, ABOUT RIGHT, or LONGER?";
      } else if (answers.waitMatch !== undefined) {
        reply = "Thanks. And did you get what you came for? Reply YES or NO.";
      } else {
        reply = SURVEY_QUESTIONS;
      }
    } else {
      const intent = parseInbound(String(params["Body"] ?? ""));
      const holdsAPlace =
        existing !== undefined &&
        (existing.status === "provisional" ||
          existing.status === "waiting" ||
          existing.status === "called" ||
          existing.status === "serving");

      if (intent.kind === "join" && holdsAPlace) {
        reply = "You are already in the queue. Reply YES to confirm and hold your place.";
      } else if (intent.kind === "join") {
        // C4's rule, unchanged: estimate BEFORE joining, so the stored
        // prediction is the one this customer was actually given.
        const waitingNow = (await readQueue(locationId)).filter((e) => e.status === "waiting").length;
        const atJoin = await estimateWaitFor({ locationId, aheadInQueue: waitingNow });
        const joined = await joinQueue({
          locationId,
          channel: "whatsapp",
          contact: from,
          actor: "customer",
          predictedLowMinutes: atJoin.kind === "estimate" ? atJoin.lowMinutes : null,
          predictedHighMinutes: atJoin.kind === "estimate" ? atJoin.highMinutes : null,
        });
        // R-G: renderEstimate carries a RANGE or the honest refusal, never a
        // point value, and it owns both wordings so this caller cannot soften
        // one into the other.
        // ASKS FOR ONE THING. The old reply asked for a confirmation AND a name
        // in the same breath; only one reply can be first, customers sent the
        // YES they were told to send first, and the name never arrived. The
        // board then showed a bare phone number for the whole visit.
        //
        // The estimate is still computed and stored BEFORE the join, unchanged,
        // so the stored prediction remains the one this customer was given. It
        // is simply not quoted until there is a name to quote it to.
        reply = joined.ok
          ? NAME_ASK
          : "We could not add you to the queue just now. Please ask at reception.";
      } else if (
        // STILL OWES US A SERVICE TYPE. This branch sits ABOVE yes and no on
        // purpose: "1" parses as affirmative and "2" as negative, so a customer
        // answering the menu would otherwise have their answer read as a
        // confirmation or a refusal. Resolved against state, exactly as the
        // survey resolves the same collision.
        //
        // Guarded to provisional and waiting, so a CALLED customer's READY and
        // NO still reach their own branches below.
        existing !== undefined &&
        existing.name !== null &&
        existing.service_type_id === null &&
        (existing.status === "provisional" || existing.status === "waiting") &&
        intent.kind !== "leave"
      ) {
        const menu = await readServiceTypes(locationId);
        const labels = menu.map((m) => m.label);
        const picked = parseServiceChoice(String(params["Body"] ?? ""), labels);
        const chosen = picked === null ? undefined : menu[picked];
        if (chosen === undefined) {
          // Unrecognised, or ambiguous between two services. The menu is shown
          // again rather than a guess being made: a wrong pick puts them in the
          // wrong bucket and hands them somebody else's estimate.
          reply = serviceMenuText(existing.name, labels);
        } else {
          const set = await recordEntryServiceType({
            entryId: existing.id,
            locationId,
            serviceTypeId: chosen.id,
          });
          reply = set.ok
            ? `${chosen.label}. ${await placeLine(locationId, existing.id, chosen.id)} ` +
              `Reply YES to confirm and hold your place.`
            : "We could not record that just now. Please ask at reception.";
        }
      } else if (intent.kind === "affirmative" && existing?.status === "called") {
        // READY. The same check-in the desk performs, arrived at from the other
        // end of the conversation. It sits ABOVE the provisional branch and is
        // guarded on status, so nothing about confirming a place changes shape.
        const arrived = await checkIn({ entryId: existing.id, locationId, actor: "customer" });
        reply = arrived.ok
          ? "Thank you - please come to the counter now."
          : "We could not check you in just now. Please ask at reception.";
      } else if (intent.kind === "negative" && existing?.status === "called") {
        // NOT READY. No transport is passed: this reply already carries
        // DEFERRED_TEXT, and sending it here too would deliver the customer the
        // same sentence twice for one message they sent.
        const moved = await deferEntry({
          entryId: existing.id,
          locationId,
          trigger: "customer_not_ready",
          actor: "customer",
        });
        reply = moved.ok
          ? DEFERRED_TEXT
          : "We could not move your place just now. Please ask at reception.";
      } else if (intent.kind === "affirmative" && existing?.status === "provisional") {
        if (existing.name === null) {
          // THE NAME IS THE GATE. Confirming an unnamed entry is what produced a
          // board showing a bare phone number, which is a privacy defect on any
          // screen a stranger can see. Applies to whatsapp only: qr and
          // reception enter at `waiting` already confirmed (X8), never pass
          // through provisional, and so never reach this branch.
          reply = NAME_ASK;
        } else {
          const confirmed = await confirmEntry({
            entryId: existing.id,
            locationId,
            actor: "customer",
          });
          reply = confirmed.ok
            ? `Confirmed, ${existing.name}. ` +
              `${await placeLine(locationId, existing.id, existing.service_type_id)} ` +
              CALL_WINDOW_NOTICE
            : "We could not confirm just now. Please ask at reception.";
        }
      } else if (intent.kind === "leave" && existing?.status === "waiting") {
        const left = await leaveQueue({
          entryId: existing.id,
          locationId,
          actor: "customer",
          fromStatus: "waiting",
        });
        reply = left.ok
          ? "You have left the queue. Message JOIN if you would like a new place in line."
          : "We could not remove you just now. Please ask at reception.";
      } else if (
        intent.kind === "unknown" &&
        existing !== undefined &&
        existing.name === null &&
        holdsAPlace
      ) {
        // FE-001. The name capture. THE PRECEDENCE IS THE SAFETY: every
        // recognised intent is handled ABOVE this branch, so "yes", "leave"
        // and "join" can never be recorded as someone's name. Only free text
        // from a customer who holds a place and has no name lands here, which
        // is exactly the reply the join prompt asked for.
        const named = await recordEntryName({
          entryId: existing.id,
          locationId,
          name: intent.text,
        });
        // The name hands straight to the service menu rather than to the
        // confirmation. Position and wait are quoted AFTER the service is
        // known, because that is the point at which the number is theirs
        // rather than the branch's average.
        reply = named.ok
          ? serviceMenuText(intent.text, (await readServiceTypes(locationId)).map((m) => m.label))
          : "Reply JOIN to take a place in line, YES to confirm, or LEAVE to give up your place.";
      } else {
        reply = "Reply JOIN to take a place in line, YES to confirm, or LEAVE to give up your place.";
      }
    }

    // Out through the existing adapter. A failed send is reported and does not
    // change what already happened in the queue: the customer's place was
    // taken or given up before this line, and a transport outage must not undo
    // it or make the webhook look failed to Twilio, which would retry and
    // re-run the action.
    const delivery = await outboundTransport().send({
      to: from,
      body: reply,
      entryId: existing?.id ?? "unassigned",
    });
    if (!delivery.ok) console.warn(`[twilio] outbound reply not sent: ${delivery.reason}`);

    res.status(200).type("text/xml").send(EMPTY_TWIML);
  });

  // RULED by King B 2026-08-18: close-of-day is MANAGER-ONLY. Releasing the
  // entire queue is a materially larger act than any desk-level operation.
  app.post("/api/close-of-day", manager, async (req, res) => {
    const body = req.body as { locationId?: string; actor?: string };
    if (typeof body.locationId !== "string") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    send(res, await closeOfDay({ locationId: body.locationId, actor: body.actor ?? "operator" }));
  });

  return app;
}

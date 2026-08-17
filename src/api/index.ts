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
  closeOfDay,
  completeService,
  confirmEntry,
  joinQueue,
  leaveQueue,
  markNoShow,
  estimateWaitFor,
  recordSurveyResponse,
  removeProvisional,
  sendConfirmationPrompt,
  sendSurvey,
  undoCall,
  undoCheckIn,
} from "../orchestrator/apply/index.ts";
import type { WaitMatch } from "../orchestrator/apply/index.ts";
import {
  checkLiveness,
  readCounters,
  readDayTotals,
  readEvents,
  readLocations,
  readQueue,
  readServiceTypes,
  readSurveyStatus,
} from "../persistence/read/index.ts";
import type { Channel } from "../domain/index.ts";
import { SimulatedTransport } from "../tools/whatsapp/simulated.ts";
import { describeBasis, renderEstimate } from "../agents/wait-time.ts";
import { readAdherence, readDashboard } from "../persistence/read/dashboard.ts";

// The console runs on the simulated surface, per King B's B5 choice: simulated
// first, Twilio behind it. This instance is shared so the phone view can read
// the same inbox the console wrote to.
const transport = new SimulatedTransport();

export function consoleTransport(): SimulatedTransport {
  return transport;
}

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

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

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

  app.get("/api/locations", async (_req, res) => {
    res.json({ ok: true, value: await readLocations() });
  });

  // The console's whole read model in one call, so the two sides cannot drift
  // by fetching at different moments.
  // C0. Counters and service types are DATA the console reads, not a hardcoded
  // array it ships. A counter typed into a form cannot be measured against.
  app.get("/api/counters", async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    res.json({ ok: true, value: await readCounters(locationId) });
  });

  app.get("/api/service-types", async (req, res) => {
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
  app.get("/api/dashboard", async (req, res) => {
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
  app.get("/api/adherence", async (req, res) => {
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

  app.get("/api/board", async (req, res) => {
    const locationId = String(req.query["locationId"] ?? "");
    if (locationId === "") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
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
  app.get("/api/inbox", (req, res) => {
    const entryId = String(req.query["entryId"] ?? "");
    res.json({ ok: true, value: transport.inbox(entryId === "" ? undefined : entryId) });
  });

  app.post("/api/join", async (req, res) => {
    const body = req.body as { locationId?: string; channel?: string; contact?: string };
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
        transport,
        body:
          "You are in the queue. Reply to confirm and hold your place in line. " +
          renderEstimate(atJoin),
      });
    }
    send(res, result);
  });

  app.post("/api/call-next", async (req, res) => {
    const body = req.body as { locationId?: string; counter?: string; actor?: string };
    if (typeof body.locationId !== "string") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    send(
      res,
      await callNext({
        locationId: body.locationId,
        actor: body.actor ?? "operator",
        counter: body.counter ?? null,
      }),
    );
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
      if (done.ok) await sendSurvey({ entryId, locationId, transport });
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
    app.post(`/api/${verb}`, async (req, res) => {
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

  app.post("/api/close-of-day", async (req, res) => {
    const body = req.body as { locationId?: string; actor?: string };
    if (typeof body.locationId !== "string") {
      res.status(400).json({ ok: false, reason: "locationId is required" });
      return;
    }
    send(res, await closeOfDay({ locationId: body.locationId, actor: body.actor ?? "operator" }));
  });

  return app;
}

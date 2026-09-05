// The apply path. THE SINGLE WRITE PATH IN THE SYSTEM. Phase 2, B3.
//
// X13: this module exposes NAMED OPERATIONS. It is not a barrel. It never
// re-exports a pool, a client, or any value obtained from persistence/write/.
// `writePool` is imported, used, and never handed onward, so no caller can
// reach the database except through the operations below.
//
// CO-2, the governed write function, closing the finding that I8's emission
// mechanism had no owner. THE PROPERTY, per Build Order 2 B3:
//   every write that changes an entry's status or its place in line, and the
//   `events` row recording it, occur inside ONE transaction through ONE
//   function. No other module writes to entries.
// That function is `applyStatusChange` below. It is deliberately NOT exported:
// every named operation routes through it, and nothing else can call it.
//
// TIER: C as of 2026-08-16, raised from V and NOT further.
//
// The order set the condition: "V until something rejects a write that bypasses
// it, and C once a test asserts the function is the only writer." That test now
// exists. `scripts/boundary-check.ts` asserts CO-2 over `src/`, and it has been
// demonstrated capable of failing, so this is a checked property rather than a
// convention.
//
// THE SCOPE OF THAT CLAIM, stated so it is not read wider than it is: the
// checker binds `src/`. It does not bind `scripts/` or `tests/`, which use
// hms_ddl to seed and tear down fixtures deliberately. A future module placed
// outside src/ could write to entries and the checker would not see it.
//
// IT IS STILL NOT TIER S. Nothing in the database prevents a second writer;
// hms_rw holds INSERT and UPDATE on entries and always will, because the
// governed write needs them. Append-only enforcement is B2's revokes on
// `events`, which is a different guarantee by a different mechanism.
//
// X10: every queue write takes pg_try_advisory_xact_lock(location) inside an
// explicit transaction. Transaction scope, non-blocking. A failed acquisition
// returns a typed skipped result and increments an operational counter; it is
// an operational event, never a fairness event.

import type pg from "pg";

import {
  DEFAULT_MAX_SEND_ATTEMPTS,
  callDeadlinePassed,
  carriedByCloseOfDay,
  checkTransition,
  initialStatusFor,
  releasedByCloseOfDay,
  selectNextToCall,
  sendAttemptsExhausted,
  triggerForJoin,
} from "../../domain/index.ts";
import type {
  Channel,
  CloseOfDayPolicy,
  QueueEntry,
  Status,
  Trigger,
} from "../../domain/index.ts";
import { newOperationalCounter, statusChangeEvent } from "../../governance/index.ts";
import { estimateWait } from "../../agents/wait-time.ts";
import type { CompletedService, WaitEstimate } from "../../agents/wait-time.ts";
import { writePool } from "../../persistence/write/index.ts";
import type { Transport } from "../../tools/whatsapp/index.ts";

// I11's shape, used as the house contract: never throw across the boundary.
export type Applied<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export const counters = newOperationalCounter();

type EntryRow = {
  readonly id: string;
  readonly status: Status;
  readonly joined_at: Date;
  readonly location_id: string;
  readonly left_reason: string | null;
  readonly confirmed_at: Date | null;
};

// ---------------------------------------------------------------------------
// The lock. X10.
// ---------------------------------------------------------------------------
async function withQueueLock<T>(
  locationId: string,
  work: (client: pg.PoolClient) => Promise<Applied<T>>,
): Promise<Applied<T>> {
  const client = await writePool().connect();
  try {
    await client.query("BEGIN");

    // Non-blocking and transaction-scoped: released at COMMIT or ROLLBACK, so
    // a crash cannot strand the lock. hashtextextended maps the uuid to the
    // bigint the lock API takes.
    const lock = await client.query<{ got: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS got",
      [locationId],
    );

    if (lock.rows[0]?.got !== true) {
      await client.query("ROLLBACK");
      counters.lockContention += 1;
      return { ok: false, reason: "lock_unavailable" };
    }

    const result = await work(client);

    if (result.ok) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// THE GOVERNED WRITE. Not exported. Every status change goes through here, and
// the fairness event is written in the SAME transaction, so an entry cannot
// move without its event. That co-location is the mechanism; a convention that
// callers "remember to log" is what X7 and CO-2 exist to replace.
// ---------------------------------------------------------------------------
async function applyStatusChange(
  client: pg.PoolClient,
  input: {
    readonly entry: EntryRow;
    readonly to: Status;
    readonly trigger: Trigger;
    readonly actor: string | null;
    readonly reason?: string | null;
    readonly approver?: string | null;
    // LITERAL SQL ONLY. Every call site passes a constant written in this file
    // (`left_reason = 'close_of_day'`, `counter = NULL`, `confirmed_at = now()`).
    // NOTHING DERIVED FROM USER INPUT MAY EVER BE PASSED HERE: it is
    // concatenated into the statement, so a caller-supplied value would be an
    // injection. Values that come from outside go through `counter` below, or
    // get their own parameter.
    readonly extraSet?: string;
    // Caller-supplied, therefore PARAMETERISED. The console names its counters.
    readonly counter?: string | null;
    // C0. The resolved counters row. The label above is RETAINED as derived
    // display, because B6 asserts it and dropping it would break that proof;
    // this is the identity a service is actually attributed to.
    readonly counterId?: string | null;
  },
): Promise<Applied<{ readonly entryId: string; readonly eventId: string }>> {
  const approver = input.approver ?? null;
  const check = checkTransition(input.entry.status, input.to, input.trigger, approver);
  if (!check.ok) {
    return { ok: false, reason: check.reason };
  }

  const sets = ["status = $1"];
  const params: unknown[] = [input.to];

  if (input.counter !== undefined) {
    params.push(input.counter);
    sets.push(`counter = $${String(params.length)}`);
  }
  if (input.counterId !== undefined) {
    params.push(input.counterId);
    sets.push(`counter_id = $${String(params.length)}`);
  }
  // C1. The service window, written HERE and derived from the transition
  // itself rather than passed in by a caller.
  //
  // This placement is the whole point. C1 says both are "written by the
  // governed write function, in the same transaction as the status change and
  // its fairness event, exactly as every other entry write. No second write
  // path." Deriving them from `from` and `to` means every route into and out of
  // serving gets them, including ones written later by someone who never read
  // this comment. A caller-supplied timestamp would be a rule to remember, and
  // rules to remember are what CO-2 exists to replace.
  //
  // On RE-ENTERING serving, ended_at is cleared as started_at is set. An
  // accidental check-in that is undone and redone would otherwise leave
  // ended_at earlier than started_at, and a derived duration would go negative.
  // The undo is still in the fairness log; what is reset is the window, not the
  // history.
  if (input.to === "serving") {
    sets.push("serving_started_at = now()", "serving_ended_at = NULL");
  } else if (input.entry.status === "serving") {
    sets.push("serving_ended_at = now()");
  }

  if (input.extraSet !== undefined) {
    sets.push(input.extraSet);
  }

  params.push(input.entry.id);
  await client.query(
    `UPDATE entries SET ${sets.join(", ")} WHERE id = $${String(params.length)}`,
    params,
  );

  const ev = statusChangeEvent({
    from: input.entry.status,
    to: input.to,
    trigger: input.trigger,
    actor: input.actor,
    reason: input.reason ?? null,
    approver,
  });

  const written = await client.query<{ id: string }>(
    `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor, reason, approver)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.entry.location_id,
      input.entry.id,
      ev.kind,
      ev.fromStatus,
      ev.toStatus,
      ev.actor,
      ev.reason,
      ev.approver,
    ],
  );

  const eventId = written.rows[0]?.id;
  if (eventId === undefined) {
    return { ok: false, reason: "fairness event was not written; refusing to move the entry" };
  }

  return { ok: true, value: { entryId: input.entry.id, eventId } };
}

async function loadEntry(
  client: pg.PoolClient,
  entryId: string,
): Promise<EntryRow | undefined> {
  const result = await client.query<EntryRow>(
    `SELECT id, status, joined_at, location_id, left_reason, confirmed_at
       FROM entries WHERE id = $1`,
    [entryId],
  );
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Named operations. X13.
// ---------------------------------------------------------------------------

export async function joinQueue(input: {
  readonly locationId: string;
  readonly channel: Channel;
  readonly actor?: string | null;
  readonly contact?: string | null;
  // FE-001. The guest's name, captured at reception or asked for over
  // WhatsApp. Nullable: declining a name is allowed, not an error.
  readonly name?: string | null;
  // FE-001. What they came for, chosen at reception. The measurement layer
  // keys on it (C3 buckets); null is honest for channels that do not ask.
  readonly serviceTypeId?: string | null;
  // C4. The estimate the customer was given, stored so calibration can compare
  // what we SAID against what happened. Recomputing it later would compare
  // today's model against today's data and always look accurate.
  readonly predictedLowMinutes?: number | null;
  readonly predictedHighMinutes?: number | null;
}): Promise<Applied<{ readonly entryId: string; readonly status: Status }>> {
  return withQueueLock(input.locationId, async (client) => {
    const status = initialStatusFor(input.channel);
    const trigger = triggerForJoin(input.channel);

    // joined_at is deliberately absent: the server supplies it and hms_rw
    // cannot write it, which is what makes I1 structural rather than polite.
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO entries (location_id, status, channel, contact, name, service_type_id,
                            predicted_low_minutes, predicted_high_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        input.locationId,
        status,
        input.channel,
        input.contact ?? null,
        input.name ?? null,
        input.serviceTypeId ?? null,
        input.predictedLowMinutes ?? null,
        input.predictedHighMinutes ?? null,
      ],
    );
    const entryId = inserted.rows[0]?.id;
    if (entryId === undefined) return { ok: false, reason: "insert produced no row" };

    // A join IS a place-in-line change, so I8 requires its event too.
    const ev = statusChangeEvent({
      from: null,
      to: status,
      trigger,
      actor: input.actor ?? null,
    });
    await client.query(
      `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.locationId, entryId, ev.kind, ev.fromStatus, ev.toStatus, ev.actor],
    );

    return { ok: true, value: { entryId, status } };
  });
}

// B5. Send the confirmation prompt for a remote entry, with X8's bounded
// attempts. Default 3; on exhaustion the entry is marked undeliverable_at and
// the expiry window runs from that last attempt, so every provisional entry has
// a clock rather than sitting forever.
//
// TRANSPORT IS INJECTED. It is not imported statically and not chosen inside
// this function. An adapter that cannot be substituted is unobservable, and an
// unobservable branch cannot honestly be claimed to work; injection is what
// makes the failure and undeliverable paths testable without a network.
//
// THE NETWORK CALL DELIBERATELY HAPPENS OUTSIDE THE LOCK AND OUTSIDE THE
// TRANSACTION. Holding a per-location advisory lock across an await on someone
// else's HTTP endpoint would serialise an entire branch on that endpoint's
// latency, and a transport timeout would become a queue outage. Only the
// recording of the outcome takes the lock.
export type PromptOutcome = {
  readonly attempts: number;
  readonly sent: boolean;
  readonly delivered: boolean;
  readonly undeliverable: boolean;
  readonly lastReason: string | null;
};

export async function sendConfirmationPrompt(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly transport: Transport;
  readonly body?: string;
  readonly maxAttempts?: number;
}): Promise<Applied<PromptOutcome>> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_SEND_ATTEMPTS;

  // Read the destination without taking the queue lock. A read does not move
  // anyone's place in line.
  const lookup = await writePool().query<{ contact: string | null; status: Status }>(
    "SELECT contact, status FROM entries WHERE id = $1",
    [input.entryId],
  );
  const row = lookup.rows[0];
  if (row === undefined) return { ok: false, reason: "entry not found" };
  if (row.contact === null || row.contact === "") {
    return { ok: false, reason: "entry has no contact to prompt" };
  }

  const body =
    input.body ?? "You are in the queue. Reply to confirm and hold your place in line.";

  let attempts = 0;
  let sent = false;
  let delivered = false;
  let lastReason: string | null = null;

  while (attempts < maxAttempts && !sent) {
    attempts += 1;
    // The transport's I11 contract guarantees this never throws, so no
    // try/catch is needed here. If that guarantee were ever broken the
    // contract test would fail before this code did.
    const result = await input.transport.send({
      to: row.contact,
      body,
      entryId: input.entryId,
    });
    if (result.ok) {
      sent = true;
      delivered = result.value.delivered;
    } else {
      lastReason = result.reason;
    }
  }

  const undeliverable = !sent && sendAttemptsExhausted(attempts, maxAttempts);

  // Only the RECORDING takes the lock.
  const recorded = await withQueueLock<PromptOutcome>(input.locationId, async (client) => {
    if (sent) {
      await client.query(
        `UPDATE entries SET prompt_sent_at = now(),
                            prompt_delivered_at = CASE WHEN $2 THEN now() ELSE prompt_delivered_at END
          WHERE id = $1`,
        [input.entryId, delivered],
      );
    } else {
      await client.query("UPDATE entries SET prompt_failed_at = now() WHERE id = $1", [
        input.entryId,
      ]);
      if (undeliverable) {
        // The status stays `provisional`. undeliverable is a COLUMN, ruled
        // 2026-08-15: it describes the notification, not the place in line.
        await client.query("UPDATE entries SET undeliverable_at = now() WHERE id = $1", [
          input.entryId,
        ]);
      }
    }
    // No fairness event: nobody's place in line moved. A prompt is a
    // notification, and inflating the fairness log with non-events makes the
    // real ones harder to find.
    return { ok: true, value: { attempts, sent, delivered, undeliverable, lastReason } };
  });

  return recorded;
}

export type CallNextOutcome = {
  readonly calledEntryId: string | null;
  readonly counter: string | null;
  readonly steppedOver: readonly { readonly id: string; readonly joinedAt: Date }[];
};

export async function callNext(input: {
  readonly locationId: string;
  readonly actor?: string | null;
  readonly approver?: string | null;
  readonly outOfOrderEntryId?: string;
  // I7. The reason the human gave, written to the record verbatim. The modal
  // requires one; the default below only covers non-UI callers.
  readonly reason?: string | null;
  readonly counter?: string | null;
}): Promise<Applied<CallNextOutcome>> {
  return withQueueLock<CallNextOutcome>(input.locationId, async (client) => {
    // `deferred` is DERIVED HERE, inside the lock, and handed to the domain.
    // The domain is pure and cannot query; if this column is missing the skip
    // silently never happens, which is precisely the shape of defect this
    // project keeps finding. The D1 proof exists to observe it rather than
    // trust it.
    const rows = await client.query<EntryRow & { deferred: boolean }>(
      `SELECT e.id, e.status, e.joined_at, e.location_id, e.left_reason, e.confirmed_at,
              EXISTS (
                SELECT 1 FROM events d
                 WHERE d.entry_id = e.id
                   AND d.kind IN ('customer_not_ready', 'call_expiry')
                   AND NOT EXISTS (
                     SELECT 1 FROM events c
                      WHERE c.location_id = e.location_id
                        AND c.kind IN ('call_next', 'out_of_order_call')
                        AND c.occurred_at > d.occurred_at)) AS deferred
         FROM entries e
        WHERE e.location_id = $1 AND e.status IN ('provisional', 'waiting')`,
      [input.locationId],
    );

    const asDomain: QueueEntry[] = rows.rows.map((r) => ({
      id: r.id,
      status: r.status,
      joinedAt: r.joined_at,
      deferred: r.deferred,
    }));

    // C0. Resolve the label to a counters row. NOT FOUND IS NOT AN ERROR and is
    // not invented: counter_id stays null and the label still records what was
    // typed. B6 calls with "Counter 1" against a branch that has no counters
    // seeded, and it must keep passing.
    let counterId: string | null = null;
    if (input.counter !== undefined && input.counter !== null && input.counter !== "") {
      const found = await client.query<{ id: string }>(
        "SELECT id FROM counters WHERE location_id = $1 AND label = $2 AND active",
        [input.locationId, input.counter],
      );
      counterId = found.rows[0]?.id ?? null;
    }


    // Out-of-order call: gated, needs a named approver (I7). The gate is
    // enforced in domain via checkTransition, not here.
    if (input.outOfOrderEntryId !== undefined) {
      const target = rows.rows.find((r) => r.id === input.outOfOrderEntryId);
      if (target === undefined) return { ok: false, reason: "entry not in line" };
      const applied = await applyStatusChange(client, {
        entry: target,
        to: "called",
        trigger: "out_of_order_call",
        actor: input.actor ?? null,
        approver: input.approver ?? null,
        reason: input.reason !== undefined && input.reason !== null && input.reason.trim() !== ""
          ? input.reason.trim().slice(0, 300)
          : "out-of-order call",
        counter: input.counter ?? null,
        counterId,
      });
      if (!applied.ok) return applied;
      return {
        ok: true,
        value: { calledEntryId: target.id, counter: input.counter ?? null, steppedOver: [] },
      };
    }

    const selection = selectNextToCall(asDomain);
    const steppedOver = selection.steppedOver.map((e) => ({ id: e.id, joinedAt: e.joinedAt }));

    if (!selection.ok) {
      // Nobody callable. The stepped-over list is still returned, because "the
      // queue looks empty but three unconfirmed entries are holding places" is
      // exactly what the operator needs to see.
      return { ok: true, value: { calledEntryId: null, counter: null, steppedOver } };
    }

    const target = rows.rows.find((r) => r.id === selection.next.id);
    if (target === undefined) return { ok: false, reason: "selected entry vanished" };

    const applied = await applyStatusChange(client, {
      entry: target,
      to: "called",
      trigger: "call_next",
      actor: input.actor ?? null,
      reason:
        steppedOver.length === 0
          ? null
          : `stepped over ${String(steppedOver.length)} unconfirmed entr${steppedOver.length === 1 ? "y" : "ies"}`,
      counter: input.counter ?? null,
      counterId,
    });
    if (!applied.ok) return applied;

    return {
      ok: true,
      value: { calledEntryId: target.id, counter: input.counter ?? null, steppedOver },
    };
  });
}

// B6 counter operations. Each is a thin named wrapper over the governed write,
// which is the point: the console gets verbs, and every verb still goes through
// the one function that cannot move an entry without writing its event.
async function counterTransition(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly to: Status;
  readonly trigger: Trigger;
  readonly actor: string;
  readonly reason?: string;
  readonly extraSet?: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  return withQueueLock(input.locationId, async (client) => {
    const entry = await loadEntry(client, input.entryId);
    if (entry === undefined) return { ok: false, reason: "entry not found" };
    // Built conditionally rather than spread: under exactOptionalPropertyTypes
    // an explicit `extraSet: undefined` is not the same as an absent key.
    const applied = await applyStatusChange(client, {
      entry,
      to: input.to,
      trigger: input.trigger,
      actor: input.actor,
      reason: input.reason ?? null,
      ...(input.extraSet === undefined ? {} : { extraSet: input.extraSet }),
    });
    if (!applied.ok) return applied;
    return { ok: true, value: { entryId: entry.id } };
  });
}

export async function checkIn(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  return counterTransition({ ...input, to: "serving", trigger: "check_in" });
}

export async function completeService(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  // The counter is released on completion, so it does not look occupied by
  // someone who has already left.
  return counterTransition({
    ...input,
    to: "served",
    trigger: "complete",
    extraSet: "counter = NULL, counter_id = NULL",
  });
}

export async function markNoShow(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  return counterTransition({
    ...input,
    to: "noshow",
    trigger: "staff_marks_noshow",
    extraSet: "counter = NULL, counter_id = NULL",
  });
}

// C1. Undo an accidental CHECK-IN: serving -> called, v4 line 216, W22.
//
// Added because C1's reset-on-re-entry logic in the governed write was
// otherwise UNREACHABLE. The transition existed in the domain table and no
// named operation performed it, so the branch that clears serving_ended_at
// could never fire and its test passed vacuously. Defensive code for a path
// nobody can take is worse than no code: it reads as a handled case and is not.
export async function undoCheckIn(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  return counterTransition({
    ...input,
    to: "called",
    trigger: "undo_check_in",
    reason: "operator undid an accidental check-in",
  });
}

// An accidental call is undone WITHOUT the entry losing its place: position is
// derived from joined_at, which nothing here touches and hms_rw cannot write.
export async function undoCall(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  return counterTransition({
    ...input,
    to: "waiting",
    trigger: "undo_call",
    reason: "operator undid an accidental call",
    extraSet: "counter = NULL, counter_id = NULL",
  });
}

// ---------------------------------------------------------------------------
// The call response window. Spec 2026-09-05-call-response-window-design.md.
// ---------------------------------------------------------------------------

// Defined ONCE, here, because two callers send it: this module when the sweep
// expires a call, and the inbound webhook when the customer declines. Two
// copies would drift and a customer would learn the rule differently depending
// on which way they arrived at it.
export const DEFERRED_TEXT =
  "No problem - we've moved you back one place. " +
  "You keep your join time and we'll call you again shortly.";

// The two business-INITIATED messages. Every other message this system sends is
// a reply to something the customer sent; these two are sent because staff did
// something. That distinction matters beyond style: outside the WhatsApp
// session window a business-initiated message needs a pre-approved template,
// which is a Meta process and not code. In the sandbox, and inside the window,
// these send as ordinary messages.
export const calledText = (name: string | null, counter: string | null): string =>
  `${name ?? "Hello"}, you're up at ${counter ?? "the counter"}. ` +
  `Reply READY within 2 minutes. ` +
  `Reply NO if you need more time and we'll move you back one place.`;

export const completeText = (name: string | null, counter: string | null): string =>
  `Thanks for coming in${name === null ? "" : `, ${name}`}. ` +
  `Your service at ${counter ?? "the counter"} is complete.`;

// Tell a customer they have been called. SILENT FOR A WALK-IN: a reception or
// QR entry has no contact, and warning about an undeliverable message on every
// single call would train the operator to ignore the log.
//
// A send failure never changes queue state. The customer was called before this
// ran, and a transport outage must not reach back and un-call them.
export async function notifyEntry(input: {
  readonly entryId: string;
  readonly transport: Transport;
  readonly compose: (name: string | null, counter: string | null) => string;
}): Promise<void> {
  const row = await writePool().query<{
    contact: string | null;
    name: string | null;
    counter: string | null;
  }>("SELECT contact, name, counter FROM entries WHERE id = $1", [input.entryId]);
  const found = row.rows[0];
  if (found === undefined) return;
  if (found.contact === null || found.contact === "") return;

  const delivery = await input.transport.send({
    to: found.contact,
    body: input.compose(found.name, found.counter),
    entryId: input.entryId,
  });
  if (!delivery.ok) console.warn(`[notify] not sent for ${input.entryId}: ${delivery.reason}`);
}

// A called customer who is not ready yet. The entry returns to `waiting` with
// its joined_at UNTOUCHED, so it does not move in the line at all; what changes
// is that the fairness log now carries a deferral event, and readQueue derives
// `deferred` from that until the next person is called.
//
// The status change is conditional by construction: applyStatusChange refuses a
// transition whose `from` does not match the row it loaded under the queue
// lock, so a check-in landing in the same instant wins and this becomes a
// no-op rather than clobbering it.
export async function deferEntry(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly trigger: "customer_not_ready" | "call_expiry";
  readonly actor: string;
  // Optional: the inbound path already answers the customer in its own reply,
  // and sending here too would deliver the same sentence twice.
  readonly transport?: Transport;
}): Promise<Applied<{ readonly entryId: string }>> {
  const moved = await counterTransition({
    entryId: input.entryId,
    locationId: input.locationId,
    to: "waiting",
    trigger: input.trigger,
    actor: input.actor,
    reason:
      input.trigger === "customer_not_ready"
        ? "customer said they were not ready"
        : "no reply within the call response window",
    // The counter is released. Somebody else is about to use it.
    extraSet: "counter = NULL, counter_id = NULL",
  });
  if (!moved.ok) return moved;

  if (input.transport !== undefined) {
    const to = await writePool().query<{ contact: string | null }>(
      "SELECT contact FROM entries WHERE id = $1",
      [input.entryId],
    );
    const contact = to.rows[0]?.contact ?? null;
    if (contact !== null && contact !== "") {
      const delivery = await input.transport.send({
        to: contact,
        body: DEFERRED_TEXT,
        entryId: input.entryId,
      });
      // A failed send does NOT undo the deferral. The place in line already
      // moved; a transport outage must not reach back and change queue state.
      if (!delivery.ok) console.warn(`[defer] notice not sent: ${delivery.reason}`);
    }
  }

  return moved;
}

// LAZY EXPIRY. There is no scheduler in this codebase and this does not add
// one: the deadline is evaluated whenever somebody looks at the branch, which
// in practice is the desk console's board poll.
//
// `called_at` is DERIVED from the fairness log, not stored. Nothing holds a
// called_at column, so nothing can disagree with the log about when the call
// happened.
export async function sweepCallDeadlines(input: {
  readonly locationId: string;
  readonly transport: Transport;
}): Promise<Applied<{ readonly deferredEntryIds: readonly string[] }>> {
  const candidates = await writePool().query<{ id: string; called_at: Date | null }>(
    `SELECT e.id,
            (SELECT max(c.occurred_at) FROM events c
              WHERE c.entry_id = e.id
                AND c.kind IN ('call_next', 'out_of_order_call')) AS called_at
       FROM entries e
      WHERE e.location_id = $1 AND e.status = 'called'`,
    [input.locationId],
  );

  const now = new Date();
  const deferredEntryIds: string[] = [];

  for (const row of candidates.rows) {
    // NO CALL EVENT, NO SWEEP. An entry called before this feature existed, or
    // by a path that wrote no event, has no deadline that can be established.
    // Guessing one would expire somebody on a number nobody recorded.
    if (row.called_at === null) continue;
    if (!callDeadlinePassed(row.called_at, now)) continue;

    const moved = await deferEntry({
      entryId: row.id,
      locationId: input.locationId,
      trigger: "call_expiry",
      actor: "system",
      transport: input.transport,
    });
    if (moved.ok) deferredEntryIds.push(row.id);
  }

  return { ok: true, value: { deferredEntryIds } };
}

export async function leaveQueue(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
  readonly fromStatus: Status;
}): Promise<Applied<{ readonly entryId: string }>> {
  return counterTransition({
    entryId: input.entryId,
    locationId: input.locationId,
    to: "left",
    trigger: "customer_leaves",
    actor: input.actor,
    extraSet: "left_reason = 'customer_left'",
  });
}

export async function confirmEntry(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor?: string | null;
}): Promise<Applied<{ readonly entryId: string }>> {
  return withQueueLock(input.locationId, async (client) => {
    const entry = await loadEntry(client, input.entryId);
    if (entry === undefined) return { ok: false, reason: "entry not found" };

    // confirmed_at is set in the same statement as the status, so a confirmed
    // entry can never exist without its timestamp. joined_at is untouched:
    // confirmation changes callability, never position (I2).
    const applied = await applyStatusChange(client, {
      entry,
      to: "waiting",
      trigger: "customer_confirms",
      actor: input.actor ?? null,
      extraSet: "confirmed_at = now()",
    });
    if (!applied.ok) return applied;
    return { ok: true, value: { entryId: entry.id } };
  });
}

// X8 third exit. R-A: ungated, unconditional, no role check, no approver.
// Bounded to provisional only, which domain enforces.
export async function removeProvisional(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
  readonly reason: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  return withQueueLock(input.locationId, async (client) => {
    const entry = await loadEntry(client, input.entryId);
    if (entry === undefined) return { ok: false, reason: "entry not found" };

    const applied = await applyStatusChange(client, {
      entry,
      to: "left",
      trigger: "operator_removal",
      actor: input.actor,
      reason: input.reason,
      extraSet: "left_reason = 'operator_removal'",
    });
    if (!applied.ok) return applied;
    return { ok: true, value: { entryId: entry.id } };
  });
}

// X9a. The sweep's write is CONDITIONAL, which is the fix: a confirm racing an
// expire cannot be overwritten, because the UPDATE simply matches no row once
// confirmed_at is set.
export async function expireProvisional(input: {
  readonly locationId: string;
  readonly olderThanSeconds: number;
}): Promise<Applied<{ readonly expired: readonly string[] }>> {
  return withQueueLock(input.locationId, async (client) => {
    const candidates = await client.query<EntryRow>(
      `SELECT id, status, joined_at, location_id, left_reason, confirmed_at
         FROM entries
        WHERE location_id = $1
          AND status = 'provisional'
          AND confirmed_at IS NULL
          AND COALESCE(undeliverable_at, prompt_delivered_at, prompt_sent_at, joined_at)
              < now() - make_interval(secs => $2)`,
      [input.locationId, input.olderThanSeconds],
    );

    const expired: string[] = [];
    for (const entry of candidates.rows) {
      const applied = await applyStatusChange(client, {
        entry,
        to: "left",
        trigger: "provisional_expiry",
        actor: "system",
        reason: "provisional expiry",
        extraSet: "left_reason = 'provisional_expiry'",
      });
      if (!applied.ok) return applied;
      expired.push(entry.id);
    }
    return { ok: true, value: { expired } };
  });
}

// X9a bounded reversal. Ungated, but ONLY for an entry whose left_reason is
// provisional_expiry. The bound is checked here because it is a data condition
// rather than a transition rule.
export async function reinstateAfterExpiry(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly actor: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  return withQueueLock(input.locationId, async (client) => {
    const entry = await loadEntry(client, input.entryId);
    if (entry === undefined) return { ok: false, reason: "entry not found" };
    if (entry.left_reason !== "provisional_expiry") {
      return {
        ok: false,
        reason: `reinstatement is bounded to provisional_expiry; this entry left for ${String(entry.left_reason)}`,
      };
    }

    // joined_at is retained, so the entry returns to its ORIGINAL position.
    // Nothing in this statement touches it, and hms_rw could not write it if it
    // tried.
    const applied = await applyStatusChange(client, {
      entry,
      to: "waiting",
      trigger: "reinstate_after_expiry",
      actor: input.actor,
      reason: "reinstated after disputed expiry",
      extraSet: "left_reason = NULL",
    });
    if (!applied.ok) return applied;
    return { ok: true, value: { entryId: entry.id } };
  });
}

// B4. Close of day. Triggered by the operator from the console; NO SCHEDULER
// this pass. Runs in ONE transaction under the same per-location lock as every
// other queue write, so a close cannot interleave with a Call Next.
//
// Policy is READ FROM THE LOCATION ROW, per R-B. It is deliberately not a
// parameter: making it an argument would recreate the console button R-B exists
// to prevent, where a mid-operation flip becomes possible and someone has to
// decide who may press it.
export type CloseOfDayOutcome = {
  readonly policy: CloseOfDayPolicy;
  readonly released: readonly string[];
  readonly carried: readonly string[];
  readonly untouchedServing: readonly string[];
  // B5 hook. Customer notification is a B5 concern; the released set is handed
  // back so the transport layer can act on it without close-of-day needing to
  // know a transport exists.
  readonly notify: readonly string[];
};

export async function closeOfDay(input: {
  readonly locationId: string;
  readonly actor: string;
}): Promise<Applied<CloseOfDayOutcome>> {
  return withQueueLock<CloseOfDayOutcome>(input.locationId, async (client) => {
    const config = await client.query<{ close_of_day_policy: CloseOfDayPolicy }>(
      "SELECT close_of_day_policy FROM locations WHERE id = $1",
      [input.locationId],
    );
    const policy = config.rows[0]?.close_of_day_policy;
    if (policy === undefined) return { ok: false, reason: "location not found" };

    const rows = await client.query<EntryRow>(
      `SELECT id, status, joined_at, location_id, left_reason, confirmed_at
         FROM entries
        WHERE location_id = $1
          AND status IN ('provisional', 'waiting', 'called', 'serving')`,
      [input.locationId],
    );

    const asDomain: QueueEntry[] = rows.rows.map((r) => ({
      id: r.id,
      status: r.status,
      joinedAt: r.joined_at,
    }));

    const toRelease = releasedByCloseOfDay(asDomain, policy);
    const carried = carriedByCloseOfDay(asDomain, policy);
    const serving = asDomain.filter((e) => e.status === "serving");

    // ONE EVENT PER ENTRY. A bulk release is many place-in-line changes, not
    // one, and I8 requires each to be recorded. Looping through the governed
    // write is the point, not an inefficiency to optimise away.
    const released: string[] = [];
    for (const target of toRelease) {
      const row = rows.rows.find((r) => r.id === target.id);
      if (row === undefined) return { ok: false, reason: "entry vanished mid-close" };

      const applied = await applyStatusChange(client, {
        entry: row,
        to: "left",
        trigger: "close_of_day",
        actor: input.actor,
        reason: `close of day, policy ${policy}`,
        extraSet: "left_reason = 'close_of_day'",
      });
      if (!applied.ok) return applied;
      released.push(row.id);
    }

    return {
      ok: true,
      value: {
        policy,
        released,
        carried: carried.map((e) => e.id),
        untouchedServing: serving.map((e) => e.id),
        notify: released,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// C2. The survey. Two questions, per R-H, because response rate over WhatsApp
// collapses past two taps.
//
// A SURVEY IS NOT A FAIRNESS EVENT AND WRITES NOTHING TO `events`. The fairness
// log records changes to place in line, and it is the one artifact in this
// system whose meaning is currently exact. Mixing satisfaction data into it
// would make "how many events did this entry generate" stop answering "how many
// times did this person's place change", which is the only question the log
// exists to answer.
//
// Sent through the SAME transport interface as the confirmation prompt, so the
// simulated surface carries it identically to Twilio and the survey demos with
// or without an account.
// ---------------------------------------------------------------------------
export const SURVEY_QUESTIONS =
  "Two quick questions. 1) Did you get what you came for? Reply YES or NO. " +
  "2) How was the wait: SHORTER than expected, ABOUT RIGHT, or LONGER?";

export type SurveySendOutcome = {
  readonly sent: boolean;
  readonly surveyId: string | null;
  readonly reason: string | null;
};

export async function sendSurvey(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly transport: Transport;
}): Promise<Applied<SurveySendOutcome>> {
  // Read the destination outside the lock; a read moves nobody's place in line.
  const lookup = await writePool().query<{ contact: string | null; status: Status }>(
    "SELECT contact, status FROM entries WHERE id = $1",
    [input.entryId],
  );
  const row = lookup.rows[0];
  if (row === undefined) return { ok: false, reason: "entry not found" };

  // An on-site entry has no contact. That is not a failure, it is a fact about
  // walk-ins, and the honest result is "not sent" with the reason rather than a
  // survey row that was never delivered inflating the sent count.
  if (row.contact === null || row.contact === "") {
    return { ok: true, value: { sent: false, surveyId: null, reason: "no contact to survey" } };
  }

  // The network call happens OUTSIDE the lock, for the same reason as the
  // confirmation prompt: a transport timeout must not become a queue outage.
  const delivery = await input.transport.send({
    to: row.contact,
    body: SURVEY_QUESTIONS,
    entryId: input.entryId,
  });

  if (!delivery.ok) {
    return { ok: true, value: { sent: false, surveyId: null, reason: delivery.reason } };
  }

  return withQueueLock<SurveySendOutcome>(input.locationId, async (client) => {
    // ON CONFLICT DO NOTHING enforces "asked once" at the database rather than
    // by the caller remembering. A second survey would both annoy and
    // double-count in every rate the dashboard shows.
    const created = await client.query<{ id: string }>(
      `INSERT INTO surveys (entry_id) VALUES ($1)
       ON CONFLICT (entry_id) DO NOTHING RETURNING id`,
      [input.entryId],
    );
    const surveyId = created.rows[0]?.id ?? null;
    return {
      ok: true,
      value: {
        sent: surveyId !== null,
        surveyId,
        reason: surveyId === null ? "already surveyed" : null,
      },
    };
  });
}

export type WaitMatch = "shorter" | "as_expected" | "longer";

export async function recordSurveyResponse(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly achieved: boolean;
  readonly waitMatch: WaitMatch;
}): Promise<Applied<{ readonly surveyId: string }>> {
  return withQueueLock(input.locationId, async (client) => {
    // responded_at is set in the SAME statement as the answers, so a responded
    // survey can never exist without its timestamp, and an unanswered one is
    // distinguishable from one answered with a false.
    const updated = await client.query<{ id: string }>(
      `UPDATE surveys
          SET responded_at = now(), achieved = $2, wait_match = $3
        WHERE entry_id = $1 AND responded_at IS NULL
        RETURNING id`,
      [input.entryId, input.achieved, input.waitMatch],
    );
    const surveyId = updated.rows[0]?.id;
    if (surveyId === undefined) {
      return { ok: false, reason: "no unanswered survey for this entry" };
    }
    // Deliberately NO event write here. See the note above this section.
    return { ok: true, value: { surveyId } };
  });
}

// ---------------------------------------------------------------------------
// FE-001. Recording a guest's name after the fact. The WhatsApp flow learns
// the name one message AFTER the join, so this is an UPDATE, and it is
// deliberately narrow: name only, only when none is set, never overwriting a
// name already given. NOT a fairness event: a name changes nobody's place in
// line, so it writes nothing to `events`, same reasoning as the survey.
// ---------------------------------------------------------------------------
export async function recordEntryName(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly name: string;
}): Promise<Applied<{ readonly entryId: string }>> {
  const trimmed = input.name.trim().slice(0, 80);
  if (trimmed === "") return { ok: false, reason: "empty name" };
  const updated = await writePool().query<{ id: string }>(
    `UPDATE entries SET name = $3
      WHERE id = $1 AND location_id = $2 AND name IS NULL
      RETURNING id`,
    [input.entryId, input.locationId, trimmed],
  );
  if (updated.rows[0] === undefined) {
    return { ok: false, reason: "entry not found or already named" };
  }
  return { ok: true, value: { entryId: input.entryId } };
}

// ---------------------------------------------------------------------------
// C3. The orchestrator's half of the wait time estimate.
//
// THE SPLIT IS THE POINT, and it is the guarantee that replaced MCP: the AGENT
// is a pure function that takes a snapshot and returns a proposal. It opens
// nothing. THIS function does the I/O, hands the agent plain values, and
// returns what the agent said without editing it.
//
// If the estimate logic lived here it would have a database connection in
// scope, and the purity claim would be a comment rather than a checked
// property. P1 and X1 make it checked.
// ---------------------------------------------------------------------------
export async function estimateWaitFor(input: {
  readonly locationId: string;
  readonly serviceTypeId?: string | null;
  readonly counterId?: string | null;
  readonly aheadInQueue: number;
  readonly hourOfDay?: number;
}): Promise<WaitEstimate> {
  // Read through the WRITE pool's client only because this module owns it; the
  // query is a plain SELECT and moves nobody's place in line.
  const rows = await writePool().query<{
    service_type_id: string | null;
    counter_id: string | null;
    hour_of_day: number;
    duration_minutes: number;
  }>(
    `SELECT service_type_id, counter_id,
            EXTRACT(HOUR FROM serving_started_at)::int AS hour_of_day,
            (EXTRACT(EPOCH FROM (serving_ended_at - serving_started_at)) / 60.0)::float8
              AS duration_minutes
       FROM entries
      WHERE location_id = $1 AND status = 'served'
        AND serving_started_at IS NOT NULL AND serving_ended_at IS NOT NULL
      ORDER BY serving_ended_at DESC LIMIT 2000`,
    [input.locationId],
  );

  const history: CompletedService[] = rows.rows.map((r) => ({
    serviceTypeId: r.service_type_id,
    counterId: r.counter_id,
    hourOfDay: r.hour_of_day,
    durationMinutes: r.duration_minutes,
  }));

  return estimateWait({
    history,
    aheadInQueue: input.aheadInQueue,
    serviceTypeId: input.serviceTypeId ?? null,
    counterId: input.counterId ?? null,
    hourOfDay: input.hourOfDay ?? new Date().getHours(),
  });
}

// Prompt tracking. These set timestamp columns and do NOT change status, so
// they are not place-in-line changes and write no fairness event. X9b.
export async function recordPromptOutcome(input: {
  readonly entryId: string;
  readonly locationId: string;
  readonly outcome: "sent" | "delivered" | "failed";
  readonly attempts?: number;
  readonly maxAttempts?: number;
}): Promise<Applied<{ readonly undeliverable: boolean }>> {
  return withQueueLock(input.locationId, async (client) => {
    const column =
      input.outcome === "sent"
        ? "prompt_sent_at"
        : input.outcome === "delivered"
          ? "prompt_delivered_at"
          : "prompt_failed_at";

    await client.query(`UPDATE entries SET ${column} = now() WHERE id = $1`, [input.entryId]);

    // X8 transport: when bounded attempts are exhausted the entry is marked
    // undeliverable and the window runs from the last attempt, so every
    // provisional entry has a clock. undeliverable is a COLUMN, ruled
    // 2026-08-15; the status stays provisional.
    let undeliverable = false;
    if (input.outcome === "failed" && input.attempts !== undefined) {
      const max = input.maxAttempts ?? 3;
      if (input.attempts >= max) {
        await client.query("UPDATE entries SET undeliverable_at = now() WHERE id = $1", [
          input.entryId,
        ]);
        undeliverable = true;
      }
    }

    return { ok: true, value: { undeliverable } };
  });
}

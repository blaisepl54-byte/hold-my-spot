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
// TIER HONESTY, stated by the order and repeated here so it is not overclaimed:
// this is tier V. It becomes C once a test asserts this function is the only
// writer. IT IS NOT TIER S, and it is NOT append-only enforcement. Append-only
// is B2's revokes on `events`, which are a different guarantee by a different
// mechanism.
//
// X10: every queue write takes pg_try_advisory_xact_lock(location) inside an
// explicit transaction. Transaction scope, non-blocking. A failed acquisition
// returns a typed skipped result and increments an operational counter; it is
// an operational event, never a fairness event.

import type pg from "pg";

import {
  DEFAULT_MAX_SEND_ATTEMPTS,
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
}): Promise<Applied<{ readonly entryId: string; readonly status: Status }>> {
  return withQueueLock(input.locationId, async (client) => {
    const status = initialStatusFor(input.channel);
    const trigger = triggerForJoin(input.channel);

    // joined_at is deliberately absent: the server supplies it and hms_rw
    // cannot write it, which is what makes I1 structural rather than polite.
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO entries (location_id, status, channel, contact)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.locationId, status, input.channel, input.contact ?? null],
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
  readonly counter?: string | null;
}): Promise<Applied<CallNextOutcome>> {
  return withQueueLock<CallNextOutcome>(input.locationId, async (client) => {
    const rows = await client.query<EntryRow>(
      `SELECT id, status, joined_at, location_id, left_reason, confirmed_at
         FROM entries
        WHERE location_id = $1 AND status IN ('provisional', 'waiting')`,
      [input.locationId],
    );

    const asDomain: QueueEntry[] = rows.rows.map((r) => ({
      id: r.id,
      status: r.status,
      joinedAt: r.joined_at,
    }));

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
        reason: "out-of-order call",
        counter: input.counter ?? null,
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
    extraSet: "counter = NULL",
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
    extraSet: "counter = NULL",
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
    extraSet: "counter = NULL",
  });
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

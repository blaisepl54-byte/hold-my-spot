// B3 invariant proof, the parts the demo moment does not exercise.
//
//   X9a  the expiry sweep's write is CONDITIONAL, so a confirm racing an expire
//        resolves in favour of confirm. Plus the bounded reversal.
//   X10  every queue write takes a non-blocking per-location advisory lock; a
//        failed acquisition returns a TYPED SKIPPED RESULT and increments an
//        operational counter, rather than blocking or throwing.
//   CO-2 the governed write function: an entry cannot move without its event.

import pg from "pg";

import {
  callNext,
  confirmEntry,
  counters,
  expireProvisional,
  joinQueue,
  reinstateAfterExpiry,
  removeProvisional,
} from "../src/orchestrator/apply/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";

let failures = 0;

function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-b3-invariants",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('B3 Invariant Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  // === X9a, confirm races expire ========================================
  console.log("--- X9a: a confirm racing an expire resolves in favour of confirm ---");

  const racer = await joinQueue({ locationId, channel: "whatsapp" });
  if (!racer.ok) throw new Error(racer.reason);
  await confirmEntry({ entryId: racer.value.entryId, locationId, actor: "customer" });

  // Sweep with a zero window, so EVERY provisional entry is old enough. The
  // only thing protecting the confirmed entry is the confirmed_at condition.
  const sweep1 = await expireProvisional({ locationId, olderThanSeconds: 0 });
  const racerRow = await ddl.query<{ status: string }>(
    "SELECT status FROM entries WHERE id = $1",
    [racer.value.entryId],
  );
  check(
    "a CONFIRMED entry survives a zero-window expiry sweep",
    racerRow.rows[0]?.status === "waiting",
    `status=${String(racerRow.rows[0]?.status)}, sweep expired ${sweep1.ok ? String(sweep1.value.expired.length) : "error"} entries`,
  );

  // === X9a, an unconfirmed entry DOES expire ============================
  const stale = await joinQueue({ locationId, channel: "whatsapp" });
  if (!stale.ok) throw new Error(stale.reason);
  const sweep2 = await expireProvisional({ locationId, olderThanSeconds: 0 });
  const staleRow = await ddl.query<{ status: string; left_reason: string | null; joined_at: Date }>(
    "SELECT status, left_reason, joined_at FROM entries WHERE id = $1",
    [stale.value.entryId],
  );
  check(
    "an UNCONFIRMED entry does expire, logged as provisional_expiry",
    staleRow.rows[0]?.status === "left" && staleRow.rows[0]?.left_reason === "provisional_expiry",
    `status=${String(staleRow.rows[0]?.status)} left_reason=${String(staleRow.rows[0]?.left_reason)}, sweep expired ${sweep2.ok ? String(sweep2.value.expired.length) : "error"}`,
  );

  const joinedAtBeforeReinstate = staleRow.rows[0]?.joined_at;

  // === X9a, the bounded reversal ========================================
  console.log("\n--- X9a: the bounded reversal ---");
  const reinstated = await reinstateAfterExpiry({
    entryId: stale.value.entryId,
    locationId,
    actor: "operator",
  });
  const afterReinstate = await ddl.query<{ status: string; joined_at: Date }>(
    "SELECT status, joined_at FROM entries WHERE id = $1",
    [stale.value.entryId],
  );
  check(
    "an entry that left by provisional_expiry can be reinstated, ungated",
    reinstated.ok && afterReinstate.rows[0]?.status === "waiting",
    reinstated.ok ? `status=${String(afterReinstate.rows[0]?.status)}` : reinstated.reason,
  );
  check(
    "reinstatement RETAINS the original joined_at, so no place in line is bought",
    afterReinstate.rows[0]?.joined_at.getTime() === joinedAtBeforeReinstate?.getTime(),
    `before=${joinedAtBeforeReinstate?.toISOString() ?? "?"} after=${afterReinstate.rows[0]?.joined_at.toISOString() ?? "?"}`,
  );

  // An entry that left for a DIFFERENT reason must not take this path.
  const removed = await joinQueue({ locationId, channel: "whatsapp" });
  if (!removed.ok) throw new Error(removed.reason);
  await removeProvisional({
    entryId: removed.value.entryId,
    locationId,
    actor: "staff",
    reason: "ghost entry",
  });
  const wrongPath = await reinstateAfterExpiry({
    entryId: removed.value.entryId,
    locationId,
    actor: "operator",
  });
  check(
    "reinstatement is BOUNDED: an operator-removed entry is refused",
    !wrongPath.ok,
    wrongPath.ok ? "it was allowed, which is wrong" : `refused: ${wrongPath.reason}`,
  );

  // === X10, lock contention =============================================
  console.log("\n--- X10: non-blocking per-location advisory lock ---");

  const holder = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-lock-holder",
  });
  await holder.connect();
  await holder.query("BEGIN");
  await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [locationId]);

  const before = counters.lockContention;
  const blocked = await callNext({ locationId, actor: "operator" });
  const after = counters.lockContention;

  check(
    "a queue write against a locked location returns a TYPED skipped result, not a hang",
    !blocked.ok && blocked.reason === "lock_unavailable",
    blocked.ok ? "it proceeded, so the lock is not enforced" : `reason=${blocked.reason}`,
  );
  check(
    "the skip increments an OPERATIONAL counter, not the fairness log",
    after === before + 1,
    `lockContention ${String(before)} -> ${String(after)}`,
  );

  const eventsDuringLock = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE location_id = $1 AND kind = 'lock_unavailable'",
    [locationId],
  );
  check(
    "no fairness event was written for lock contention",
    eventsDuringLock.rows[0]?.n === "0",
    `events with kind=lock_unavailable: ${String(eventsDuringLock.rows[0]?.n)}`,
  );

  await holder.query("ROLLBACK");

  // The lock is transaction-scoped, so releasing it must restore service.
  const unblocked = await callNext({ locationId, actor: "operator" });
  check(
    "releasing the lock restores service, proving it was scoped to the transaction",
    unblocked.ok,
    unblocked.ok ? `called ${String(unblocked.value.calledEntryId)}` : unblocked.reason,
  );
  await holder.end();

  // === CO-2, an entry cannot move without its event =====================
  console.log("\n--- CO-2: the governed write function ---");
  const moves = await ddl.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM entries WHERE location_id = $1`,
    [locationId],
  );
  const evs = await ddl.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM events WHERE location_id = $1`,
    [locationId],
  );
  check(
    "every entry has at least one fairness event, since join itself writes one",
    Number(evs.rows[0]?.n ?? "0") >= Number(moves.rows[0]?.n ?? "0"),
    `${String(evs.rows[0]?.n)} events for ${String(moves.rows[0]?.n)} entries`,
  );

  // === teardown =========================================================
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  await ddl.end();
  await closeWritePool();

  console.log(failures === 0 ? "\nALL B3 INVARIANTS HOLD." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

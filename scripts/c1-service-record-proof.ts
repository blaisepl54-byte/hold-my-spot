// C1 proof, Build Order 3 section 3.
//
// "A full lifecycle produces a non-null serving_started_at on transition into
// serving and a non-null serving_ended_at on transition out. Duration is
// derived, never stored. Every write still emits its fairness event and the
// CO-2 claim is unchanged."
//
// Plus the migration-ledger revoke folded in on King B's instruction, proven
// the only way a grant can be proven: by observed rejection.
//
// INSTRUMENT: the lifecycle is driven through orchestrator/apply's named
// operations, never by writing the columns directly. If the timestamps could be
// set by this script they would prove nothing about whether the governed write
// sets them, which is the actual claim.

import pg from "pg";

import {
  callNext,
  checkIn,
  completeService,
  joinQueue,
  undoCheckIn,
} from "../src/orchestrator/apply/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

const INSUFFICIENT_PRIVILEGE = "42501";

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-c1-proof",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('C1 Service Record Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");
  await ddl.query("INSERT INTO counters (location_id, label) VALUES ($1, 'Counter 1')", [
    locationId,
  ]);

  type Window = {
    status: string;
    serving_started_at: Date | null;
    serving_ended_at: Date | null;
    counter_id: string | null;
  };
  const windowOf = async (id: string): Promise<Window | undefined> => {
    const r = await ddl.query<Window>(
      "SELECT status, serving_started_at, serving_ended_at, counter_id FROM entries WHERE id = $1",
      [id],
    );
    return r.rows[0];
  };

  // === duration is DERIVED, never stored =================================
  console.log("--- schema ---");
  const stored = await ddl.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.columns
      WHERE table_name = 'entries'
        AND (column_name ILIKE '%duration%' OR column_name ILIKE '%elapsed%')`,
  );
  check(
    "NO duration column exists; it is derived from the two timestamps",
    stored.rows[0]?.n === "0",
    `duration-shaped columns on entries: ${String(stored.rows[0]?.n)}. A stored duration is a third fact that can disagree with the two it comes from.`,
  );

  const noServiceTable = await ddl.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.tables
      WHERE table_name IN ('service_records','services')`,
  );
  check(
    "NO separate service_records table; the entry IS the service record",
    noServiceTable.rows[0]?.n === "0",
    `service-record tables: ${String(noServiceTable.rows[0]?.n)}. A second table would be a second thing to keep consistent.`,
  );

  // === the full lifecycle ================================================
  console.log("\n--- a full lifecycle, driven through the governed write ---");
  const joined = await joinQueue({ locationId, channel: "reception", actor: "staff" });
  if (!joined.ok) throw new Error(joined.reason);
  const entryId = joined.value.entryId;

  const atJoin = await windowOf(entryId);
  check(
    "on joining, both timestamps are null; nothing has been served yet",
    atJoin?.serving_started_at === null && atJoin?.serving_ended_at === null,
    `started=${String(atJoin?.serving_started_at)} ended=${String(atJoin?.serving_ended_at)}`,
  );

  await callNext({ locationId, actor: "operator", counter: "Counter 1" });
  const atCalled = await windowOf(entryId);
  check(
    "on being called, service has still not started",
    atCalled?.serving_started_at === null,
    `status=${String(atCalled?.status)} started=${String(atCalled?.serving_started_at)}`,
  );
  check(
    "and the call resolved the counter identity (C0 still working)",
    atCalled?.counter_id !== null,
    `counter_id=${String(atCalled?.counter_id)}`,
  );

  const eventsBefore = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE entry_id = $1",
    [entryId],
  );

  await checkIn({ entryId, locationId, actor: "operator" });
  const atServing = await windowOf(entryId);
  check(
    "on transition INTO serving, serving_started_at is set",
    atServing?.serving_started_at !== null && atServing?.serving_ended_at === null,
    `started=${atServing?.serving_started_at?.toISOString() ?? "null"} ended=${String(atServing?.serving_ended_at)}`,
  );

  await new Promise((resolve) => setTimeout(resolve, 1100));

  await completeService({ entryId, locationId, actor: "operator" });
  const atServed = await windowOf(entryId);
  check(
    "on transition OUT of serving, serving_ended_at is set",
    atServed?.serving_ended_at !== null,
    `status=${String(atServed?.status)} ended=${atServed?.serving_ended_at?.toISOString() ?? "null"}`,
  );

  const derived = await ddl.query<{ seconds: string }>(
    `SELECT EXTRACT(EPOCH FROM (serving_ended_at - serving_started_at))::text AS seconds
       FROM entries WHERE id = $1`,
    [entryId],
  );
  const seconds = Number(derived.rows[0]?.seconds ?? "0");
  check(
    "duration is derivable and positive, computed from the two timestamps",
    seconds >= 1,
    `ended - started = ${seconds.toFixed(3)}s, after a deliberate 1.1s service`,
  );

  const eventsAfter = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE entry_id = $1",
    [entryId],
  );
  const newEvents = Number(eventsAfter.rows[0]?.n) - Number(eventsBefore.rows[0]?.n);
  check(
    "every write still emitted its fairness event; CO-2 is unchanged",
    newEvents === 2,
    `${String(newEvents)} new events for 2 transitions (check_in, complete)`,
  );

  // === the interrupted service, which is where a naive version goes wrong =
  console.log("\n--- an interrupted service must not produce a negative duration ---");
  const second = await joinQueue({ locationId, channel: "reception" });
  if (!second.ok) throw new Error(second.reason);
  const id2 = second.value.entryId;

  await callNext({ locationId, actor: "operator", counter: "Counter 1" });
  await checkIn({ entryId: id2, locationId, actor: "operator" });
  const started1 = (await windowOf(id2))?.serving_started_at;

  // serving -> called, an operator undoing an accidental check-in (v4 W22).
  const undone = await undoCheckIn({ entryId: id2, locationId, actor: "operator" });
  const afterUndo = await windowOf(id2);
  check(
    "undoing a check-in leaves serving and CLOSES the window",
    undone.ok && afterUndo?.status === "called" && afterUndo.serving_ended_at !== null,
    undone.ok
      ? `status=${String(afterUndo?.status)} ended=${afterUndo?.serving_ended_at?.toISOString() ?? "null"}`
      : undone.reason,
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  const resumedOk = await checkIn({ entryId: id2, locationId, actor: "operator" });
  const resumed = await windowOf(id2);
  check(
    "re-entering serving RESETS the window, so a derived duration cannot go negative",
    resumedOk.ok && resumed?.serving_ended_at === null && resumed.serving_started_at !== null,
    resumedOk.ok
      ? `started=${resumed?.serving_started_at?.toISOString() ?? "null"} ended=${String(resumed?.serving_ended_at)} (first start was ${started1?.toISOString() ?? "null"})`
      : resumedOk.reason,
  );

  const wouldBeNegative = await ddl.query<{ s: string | null }>(
    `SELECT EXTRACT(EPOCH FROM (serving_ended_at - serving_started_at))::text AS s
       FROM entries WHERE id = $1`,
    [id2],
  );
  check(
    "and the derived duration is NULL rather than negative while service is open",
    wouldBeNegative.rows[0]?.s === null,
    `derived duration = ${String(wouldBeNegative.rows[0]?.s)}. Null means "still being served", which is true.`,
  );

  // === the migration ledger, proven by REJECTION =========================
  console.log("\n--- the migration ledger revoke, folded in on instruction ---");
  const rw = new pg.Client({
    connectionString: process.env["HMS_RW_URL"],
    application_name: "hms-c1-ledger-probe",
  });
  await rw.connect();

  const refuse = async (label: string, sql: string): Promise<void> => {
    try {
      await rw.query(sql);
      check(label, false, "the operation SUCCEEDED. The ledger is writable by hms_rw.");
    } catch (error) {
      const code = pgCode(error);
      check(
        label,
        code === INSUFFICIENT_PRIVILEGE,
        `SQLSTATE ${code ?? "none"}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  await refuse(
    "hms_rw is REFUSED DELETE on schema_migrations, so it cannot make a migration re-apply",
    "DELETE FROM schema_migrations WHERE version = '001_schema_migrations.sql'",
  );
  await refuse(
    "hms_rw is REFUSED UPDATE on schema_migrations, so it cannot defeat the checksum guard",
    "UPDATE schema_migrations SET checksum = 'tampered'",
  );
  await refuse(
    "hms_rw is REFUSED INSERT on schema_migrations",
    "INSERT INTO schema_migrations (version, checksum) VALUES ('fake', 'x')",
  );

  const stillReads = await rw.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM schema_migrations",
  );
  check(
    "hms_rw CAN still read the ledger, so it is bounded rather than blinded",
    Number(stillReads.rows[0]?.n) > 0,
    `SELECT count(*) returned ${String(stillReads.rows[0]?.n)}`,
  );
  await rw.end();

  // === teardown ==========================================================
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM counters WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  await ddl.end();
  await closeWritePool();

  console.log(failures === 0 ? "\nC1 PROVEN." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

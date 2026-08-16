// B2 invariant proof. Build Order 2 rev 2, section B2.
//
// "Property, proven at runtime as hms_rw, not by reading the migration. Five
// rejections, each observed... Break-restore on at least one."
//
// The five, verbatim from the order:
//   1. a backdated INSERT into entries is rejected
//   2. an UPDATE of joined_at is rejected
//   3. a DELETE from entries is rejected
//   4. an UPDATE of an events row is rejected
//   5. a DELETE from events is rejected
//
// TIER CONSEQUENCE, per B2: I1 and I8 are tier V until these grants exist and
// reject. They become tier S on B2's completion. This script is the evidence
// for that promotion, so it must FAIL LOUDLY rather than pass quietly.
//
// INSTRUMENT: every rejection is attempted through src/persistence/write, the
// pool the application actually uses. hms_ddl gets a direct client for setup,
// teardown, and the break-restore, because only the owner can move grants.
//
// POSITIVE CONTROLS ARE INCLUDED DELIBERATELY. A role that rejects everything
// would pass a rejection-only suite while being useless. Each revoke is paired
// with a write that must still SUCCEED.

import pg from "pg";

import { writePool, closeWritePool } from "../src/persistence/write/index.ts";

type Outcome = "PASS" | "FAIL" | "UNVERIFIABLE";

const results: { outcome: Outcome; label: string; evidence: string }[] = [];

function record(outcome: Outcome, label: string, evidence: string): void {
  results.push({ outcome, label, evidence });
  console.log(`[${outcome.padEnd(12)}] ${label}`);
  console.log(`               ${evidence}`);
}

const INSUFFICIENT_PRIVILEGE = "42501";

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function expectRejection(label: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    record("FAIL", label, "the operation SUCCEEDED. The invariant is NOT enforced.");
    return false;
  } catch (error) {
    const code = pgCode(error);
    if (code === INSUFFICIENT_PRIVILEGE) {
      record("PASS", label, `rejected, SQLSTATE ${code}: ${message(error)}`);
      return true;
    }
    record(
      "UNVERIFIABLE",
      label,
      `threw with SQLSTATE ${code ?? "none"}, not ${INSUFFICIENT_PRIVILEGE}. ` +
        `A non-privilege error does not prove the grant. ${message(error)}`,
    );
    return false;
  }
}

async function expectSuccess(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    record("PASS", label, "succeeded, as it must. The role is bounded, not broken.");
  } catch (error) {
    record("FAIL", label, `should have succeeded but threw: ${message(error)}`);
  }
}

async function main(): Promise<void> {
  console.log("B2 invariant proof, I1 and I8a\n");

  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-b2-proof",
  });
  await ddl.connect();

  // ---- setup, as hms_ddl ----------------------------------------------
  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('B2 Proof Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("could not seed a location");
  console.log(`setup: seeded location ${locationId}\n`);

  const rw = writePool();

  // ---- positive control: hms_rw can create an entry --------------------
  console.log("--- positive controls ---");
  const inserted = await rw.query<{ id: string; joined_at: Date }>(
    `INSERT INTO entries (location_id, status, channel)
     VALUES ($1, 'waiting', 'reception') RETURNING id, joined_at`,
    [locationId],
  );
  const entryId = inserted.rows[0]?.id;
  if (entryId === undefined) throw new Error("hms_rw could not insert an entry");
  record(
    "PASS",
    "hms_rw CAN insert an entry, joined_at supplied by the server",
    `entry ${entryId}, joined_at=${inserted.rows[0]?.joined_at.toISOString() ?? "?"}`,
  );

  await expectSuccess("hms_rw CAN update status, an allowed column", () =>
    rw.query("UPDATE entries SET status = 'called' WHERE id = $1", [entryId]),
  );

  const ev = await rw.query<{ id: string }>(
    `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor)
     VALUES ($1, $2, 'status_change', 'waiting', 'called', 'b2-proof') RETURNING id`,
    [locationId, entryId],
  );
  const eventId = ev.rows[0]?.id;
  if (eventId === undefined) throw new Error("hms_rw could not insert an event");
  record("PASS", "hms_rw CAN append to events, so the log is writable", `event ${eventId}`);

  // ---- the five rejections --------------------------------------------
  console.log("\n--- the five rejections required by B2 ---");

  await expectRejection("1. backdated INSERT into entries is rejected", () =>
    rw.query(
      `INSERT INTO entries (location_id, status, channel, joined_at)
       VALUES ($1, 'waiting', 'qr', now() - interval '10 days')`,
      [locationId],
    ),
  );

  await expectRejection("2. UPDATE of joined_at is rejected", () =>
    rw.query("UPDATE entries SET joined_at = now() - interval '1 day' WHERE id = $1", [entryId]),
  );

  await expectRejection("3. DELETE from entries is rejected", () =>
    rw.query("DELETE FROM entries WHERE id = $1", [entryId]),
  );

  await expectRejection("4. UPDATE of an events row is rejected", () =>
    rw.query("UPDATE events SET reason = 'tampered' WHERE id = $1", [eventId]),
  );

  await expectRejection("5. DELETE from events is rejected", () =>
    rw.query("DELETE FROM events WHERE id = $1", [eventId]),
  );

  // ---- break-restore on invariant I1 ----------------------------------
  // Required by B2 on at least one. Chosen: UPDATE(joined_at), because it is
  // the invariant with the longest history of being claimed without a
  // mechanism (W9), so it is the one worth proving can actually go RED.
  console.log("\n--- break-restore on I1, UPDATE(joined_at) ---");

  await ddl.query("GRANT UPDATE (joined_at) ON entries TO hms_rw");
  let brokeRed = false;
  try {
    await rw.query("UPDATE entries SET joined_at = now() - interval '1 day' WHERE id = $1", [
      entryId,
    ]);
    brokeRed = true;
    record(
      "PASS",
      "BREAK: with the grant restored, the reorder SUCCEEDS",
      "RED observed. The test is capable of failing, so its passing is meaningful.",
    );
  } catch (error) {
    record(
      "FAIL",
      "BREAK: expected the reorder to succeed once granted",
      `it still threw, so the probe does not actually exercise the grant: ${message(error)}`,
    );
  }

  await ddl.query("REVOKE UPDATE (joined_at) ON entries FROM hms_rw");
  const restored = await expectRejection(
    "RESTORE: UPDATE of joined_at is refused again",
    () => rw.query("UPDATE entries SET joined_at = now() WHERE id = $1", [entryId]),
  );

  if (brokeRed && restored) {
    record(
      "PASS",
      "break-restore complete: RED then GREEN, both observed",
      "I1 is enforced by a mechanism that was demonstrated capable of failing.",
    );
  }

  // ---- teardown, as hms_ddl -------------------------------------------
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  console.log("\nteardown: probe rows removed by hms_ddl (hms_rw cannot delete, by design)");

  await ddl.end();
  await closeWritePool();

  // ---- summary ---------------------------------------------------------
  console.log("\n--- summary ---");
  const pass = results.filter((r) => r.outcome === "PASS").length;
  const fail = results.filter((r) => r.outcome === "FAIL").length;
  const unver = results.filter((r) => r.outcome === "UNVERIFIABLE").length;
  console.log(`PASS ${pass}   FAIL ${fail}   UNVERIFIABLE ${unver}`);

  for (const r of results.filter((x) => x.outcome !== "PASS")) {
    console.log(`  ${r.outcome}: ${r.label} -- ${r.evidence}`);
  }

  if (fail > 0 || unver > 0) {
    console.log("\nI1 and I8 REMAIN TIER V. Promotion to tier S requires all checks PASS.");
    process.exitCode = 1;
  } else {
    console.log("\nAll checks PASS. I1 and I8a are enforced structurally, tier S.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

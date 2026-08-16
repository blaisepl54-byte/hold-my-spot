// B4 proof, close of day.
//
// Order property: "Seed a queue containing all statuses, run closeOfDay under
// each policy, observe the resulting status of every entry, and observe that
// the count of new event rows equals the count of entries transitioned."
//
// Two locations are used, one per policy, because policy is a property of the
// branch (R-B) and flipping it mid-test would be the console button R-B exists
// to prevent.
//
// FIXTURE NOTE, stated rather than hidden: the seven starting states are seeded
// by hms_ddl writing statuses directly. Driving `served` and `noshow` through
// the state machine would take a dozen operations and prove nothing about
// close of day. The OPERATION UNDER TEST still goes through the governed write,
// which is what the property is about.

import pg from "pg";

import { closeOfDay } from "../src/orchestrator/apply/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";
import type { CloseOfDayPolicy, Status } from "../src/domain/index.ts";

let failures = 0;

function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

const ALL_STATUSES: Status[] = [
  "provisional",
  "waiting",
  "called",
  "serving",
  "served",
  "noshow",
  "left",
];

async function seedBranch(
  ddl: pg.Client,
  policy: CloseOfDayPolicy,
): Promise<{ locationId: string; ids: Map<string, string> }> {
  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name, close_of_day_policy) VALUES ($1, $2) RETURNING id",
    [`B4 ${policy} branch`, policy],
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  const ids = new Map<string, string>();
  for (const status of ALL_STATUSES) {
    const row = await ddl.query<{ id: string }>(
      `INSERT INTO entries (location_id, status, channel) VALUES ($1, $2, 'reception') RETURNING id`,
      [locationId, status],
    );
    const id = row.rows[0]?.id;
    if (id === undefined) throw new Error(`could not seed ${status}`);
    ids.set(status, id);
  }

  // An unreachable remote entry: provisional WITH undeliverable_at set. This is
  // the case King B's 2026-08-15 ruling turns on, so it is seeded explicitly.
  const unreachable = await ddl.query<{ id: string }>(
    `INSERT INTO entries (location_id, status, channel, undeliverable_at)
     VALUES ($1, 'provisional', 'whatsapp', now()) RETURNING id`,
    [locationId],
  );
  const unreachableId = unreachable.rows[0]?.id;
  if (unreachableId === undefined) throw new Error("could not seed unreachable");
  ids.set("undeliverable", unreachableId);

  return { locationId, ids };
}

async function statusOf(ddl: pg.Client, id: string): Promise<{ status: string; reason: string | null; joinedAt: Date }> {
  const r = await ddl.query<{ status: string; left_reason: string | null; joined_at: Date }>(
    "SELECT status, left_reason, joined_at FROM entries WHERE id = $1",
    [id],
  );
  return {
    status: String(r.rows[0]?.status),
    reason: r.rows[0]?.left_reason ?? null,
    joinedAt: r.rows[0]?.joined_at ?? new Date(0),
  };
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-b4-proof",
  });
  await ddl.connect();

  // ================= RESET =================
  console.log("=== policy: reset ===");
  const reset = await seedBranch(ddl, "reset");

  const eventsBeforeReset = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE location_id = $1",
    [reset.locationId],
  );

  const r1 = await closeOfDay({ locationId: reset.locationId, actor: "operator" });
  if (!r1.ok) throw new Error(`closeOfDay(reset) failed: ${r1.reason}`);

  console.log("\nresulting status of every seeded entry:");
  for (const [seeded, id] of reset.ids) {
    const now = await statusOf(ddl, id);
    console.log(`  ${seeded.padEnd(13)} -> ${now.status.padEnd(12)} left_reason=${String(now.reason)}`);
  }

  for (const seeded of ["waiting", "provisional", "called"]) {
    const id = reset.ids.get(seeded);
    if (id === undefined) continue;
    const now = await statusOf(ddl, id);
    check(
      `reset: ${seeded} is released to left with left_reason=close_of_day`,
      now.status === "left" && now.reason === "close_of_day",
      `status=${now.status} left_reason=${String(now.reason)}`,
    );
  }

  const unreachableReset = reset.ids.get("undeliverable");
  if (unreachableReset !== undefined) {
    const now = await statusOf(ddl, unreachableReset);
    check(
      "reset: an UNREACHABLE entry is released, because it is provisional (ruling 2026-08-15)",
      now.status === "left" && now.reason === "close_of_day",
      `status=${now.status} left_reason=${String(now.reason)}. Three statuses cover four cases.`,
    );
  }

  const servingReset = reset.ids.get("serving");
  if (servingReset !== undefined) {
    const now = await statusOf(ddl, servingReset);
    check(
      "reset: a SERVING entry is untouched, the operator completes them",
      now.status === "serving",
      `status=${now.status}`,
    );
  }

  for (const terminal of ["served", "noshow", "left"]) {
    const id = reset.ids.get(terminal);
    if (id === undefined) continue;
    const now = await statusOf(ddl, id);
    check(
      `reset: ${terminal} is untouched, it was never in line`,
      now.status === terminal,
      `status=${now.status}`,
    );
  }

  const eventsAfterReset = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE location_id = $1",
    [reset.locationId],
  );
  const newEventsReset =
    Number(eventsAfterReset.rows[0]?.n ?? "0") - Number(eventsBeforeReset.rows[0]?.n ?? "0");
  check(
    "reset: one fairness event per released entry, no batching (I8)",
    newEventsReset === r1.value.released.length,
    `${String(newEventsReset)} new events for ${String(r1.value.released.length)} released entries`,
  );

  // ================= ROLL FORWARD =================
  console.log("\n=== policy: roll_forward ===");
  const roll = await seedBranch(ddl, "roll_forward");
  const waitingId = roll.ids.get("waiting");
  const waitingBefore = waitingId === undefined ? undefined : await statusOf(ddl, waitingId);

  const eventsBeforeRoll = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE location_id = $1",
    [roll.locationId],
  );

  const r2 = await closeOfDay({ locationId: roll.locationId, actor: "operator" });
  if (!r2.ok) throw new Error(`closeOfDay(roll_forward) failed: ${r2.reason}`);

  console.log("\nresulting status of every seeded entry:");
  for (const [seeded, id] of roll.ids) {
    const now = await statusOf(ddl, id);
    console.log(`  ${seeded.padEnd(13)} -> ${now.status.padEnd(12)} left_reason=${String(now.reason)}`);
  }

  if (waitingId !== undefined && waitingBefore !== undefined) {
    const now = await statusOf(ddl, waitingId);
    check(
      "roll_forward: a WAITING entry keeps its status and carries to the next day",
      now.status === "waiting",
      `status=${now.status}`,
    );
    check(
      "roll_forward: it keeps its ORIGINAL joined_at, so its position survives the night",
      now.joinedAt.getTime() === waitingBefore.joinedAt.getTime(),
      `before=${waitingBefore.joinedAt.toISOString()} after=${now.joinedAt.toISOString()}`,
    );
  }

  for (const seeded of ["provisional", "called"]) {
    const id = roll.ids.get(seeded);
    if (id === undefined) continue;
    const now = await statusOf(ddl, id);
    check(
      `roll_forward: ${seeded} is released REGARDLESS of policy`,
      now.status === "left" && now.reason === "close_of_day",
      `status=${now.status}. Carrying an unconfirmed entry overnight would put it at the front of tomorrow's line, the harm X8 prevents.`,
    );
  }

  const unreachableRoll = roll.ids.get("undeliverable");
  if (unreachableRoll !== undefined) {
    const now = await statusOf(ddl, unreachableRoll);
    check(
      "roll_forward: an UNREACHABLE entry is released too, being provisional",
      now.status === "left",
      `status=${now.status}`,
    );
  }

  const servingRoll = roll.ids.get("serving");
  if (servingRoll !== undefined) {
    const now = await statusOf(ddl, servingRoll);
    check(
      "roll_forward: a SERVING entry is untouched",
      now.status === "serving",
      `status=${now.status}`,
    );
  }

  const eventsAfterRoll = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE location_id = $1",
    [roll.locationId],
  );
  const newEventsRoll =
    Number(eventsAfterRoll.rows[0]?.n ?? "0") - Number(eventsBeforeRoll.rows[0]?.n ?? "0");
  check(
    "roll_forward: one fairness event per released entry",
    newEventsRoll === r2.value.released.length,
    `${String(newEventsRoll)} new events for ${String(r2.value.released.length)} released entries`,
  );

  check(
    "the B5 notification hook carries the released set, without close-of-day knowing a transport exists",
    r2.value.notify.length === r2.value.released.length,
    `notify=${String(r2.value.notify.length)} released=${String(r2.value.released.length)}`,
  );

  // ================= teardown =================
  for (const id of [reset.locationId, roll.locationId]) {
    await ddl.query("DELETE FROM events WHERE location_id = $1", [id]);
    await ddl.query("DELETE FROM entries WHERE location_id = $1", [id]);
    await ddl.query("DELETE FROM locations WHERE id = $1", [id]);
  }
  await ddl.end();
  await closeWritePool();

  console.log(failures === 0 ? "\nB4 PROVEN under both policies." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

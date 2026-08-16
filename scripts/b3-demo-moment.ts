// B3 acceptance: THE DEMO MOMENT, end to end against the live database.
//
// Build Order 2 rev 2, B3: "A remote WhatsApp join lands provisional; Call Next
// visibly skips it; one tap confirms; the next Call Next serves them. This is
// what the whole build is for."
//
// The fairness claim being demonstrated is not "the queue works". It is that an
// unconfirmed remote customer HOLDS THEIR PLACE while being skipped, and on
// confirming is served AHEAD of someone who joined later. That is I3 and I2
// together, and it is only visible if the WhatsApp customer joins FIRST.
//
// Every write goes through orchestrator/apply. This script never touches
// entries directly, which is the point of CO-2.

import pg from "pg";

import {
  callNext,
  confirmEntry,
  joinQueue,
} from "../src/orchestrator/apply/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";

let failures = 0;

function check(label: string, condition: boolean, evidence: string): void {
  const tag = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`[${tag}] ${label}`);
  console.log(`       ${evidence}`);
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-b3-demo",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('Demo Branch, Half Way Tree') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("could not seed a location");

  console.log("THE DEMO MOMENT\n");
  console.log(`branch: ${locationId}\n`);

  // -- 1. the remote customer joins FIRST -------------------------------
  const remote = await joinQueue({ locationId, channel: "whatsapp", actor: "customer" });
  if (!remote.ok) throw new Error(`whatsapp join failed: ${remote.reason}`);
  check(
    "1. a remote WhatsApp join lands provisional",
    remote.value.status === "provisional",
    `entry ${remote.value.entryId} status=${remote.value.status}`,
  );

  // -- 2. an on-site customer joins SECOND ------------------------------
  const onsite = await joinQueue({ locationId, channel: "reception", actor: "staff" });
  if (!onsite.ok) throw new Error(`reception join failed: ${onsite.reason}`);
  check(
    "2. an on-site join lands waiting, auto-confirmed because presence is proof",
    onsite.value.status === "waiting",
    `entry ${onsite.value.entryId} status=${onsite.value.status}`,
  );

  const order = await ddl.query<{ id: string; joined_at: Date }>(
    "SELECT id, joined_at FROM entries WHERE location_id = $1 ORDER BY joined_at",
    [locationId],
  );
  check(
    "   the remote customer is FIRST in line by join time",
    order.rows[0]?.id === remote.value.entryId,
    `order by joined_at: ${order.rows.map((r) => (r.id === remote.value.entryId ? "REMOTE" : "onsite")).join(" then ")}`,
  );

  const joinedAtBefore = order.rows.find((r) => r.id === remote.value.entryId)?.joined_at;

  // -- 3. Call Next VISIBLY SKIPS the unconfirmed entry ------------------
  const first = await callNext({ locationId, actor: "operator" });
  if (!first.ok) throw new Error(`callNext failed: ${first.reason}`);
  check(
    "3. Call Next skips the unconfirmed remote entry and serves the on-site one",
    first.value.calledEntryId === onsite.value.entryId,
    `called ${String(first.value.calledEntryId)}, which is the ON-SITE entry`,
  );
  check(
    "   the skip is VISIBLE: steppedOver is a first-class result",
    first.value.steppedOver.length === 1 &&
      first.value.steppedOver[0]?.id === remote.value.entryId,
    `steppedOver = [${first.value.steppedOver.map((s) => s.id).join(", ")}]`,
  );

  // -- 4. one tap confirms ----------------------------------------------
  const confirmed = await confirmEntry({
    entryId: remote.value.entryId,
    locationId,
    actor: "customer",
  });
  check("4. one tap confirms", confirmed.ok, confirmed.ok ? "confirmed" : confirmed.reason);

  const after = await ddl.query<{ status: string; joined_at: Date; confirmed_at: Date | null }>(
    "SELECT status, joined_at, confirmed_at FROM entries WHERE id = $1",
    [remote.value.entryId],
  );
  check(
    "   confirming changed callability, NOT position (I2)",
    after.rows[0]?.joined_at.getTime() === joinedAtBefore?.getTime(),
    `joined_at before=${joinedAtBefore?.toISOString() ?? "?"} after=${after.rows[0]?.joined_at.toISOString() ?? "?"}`,
  );

  // -- 5. the next Call Next SERVES THEM ---------------------------------
  const second = await callNext({ locationId, actor: "operator" });
  if (!second.ok) throw new Error(`second callNext failed: ${second.reason}`);
  check(
    "5. the next Call Next serves the remote customer",
    second.value.calledEntryId === remote.value.entryId,
    `called ${String(second.value.calledEntryId)}, the REMOTE entry`,
  );
  check(
    "   and nobody is stepped over now, because nobody is unconfirmed",
    second.value.steppedOver.length === 0,
    `steppedOver = [] (length ${String(second.value.steppedOver.length)})`,
  );

  // -- I8: every place-in-line change wrote a fairness event -------------
  const events = await ddl.query<{ kind: string; from_status: string | null; to_status: string }>(
    "SELECT kind, from_status, to_status FROM events WHERE location_id = $1 ORDER BY id",
    [locationId],
  );
  console.log("\nfairness log:");
  for (const e of events.rows) {
    console.log(`  ${String(e.from_status ?? "none").padEnd(12)} -> ${e.to_status.padEnd(12)} ${e.kind}`);
  }
  // two joins, two calls, one confirm = five place-in-line changes.
  check(
    "I8: every place-in-line change wrote a fairness event",
    events.rows.length === 5,
    `${String(events.rows.length)} events for 5 changes (2 joins, 2 calls, 1 confirm)`,
  );

  // -- teardown ----------------------------------------------------------
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  await ddl.end();
  await closeWritePool();

  console.log(
    failures === 0
      ? "\nDEMO MOMENT PROVEN. The unconfirmed customer held their place, was skipped in public, and was served on confirming."
      : `\n${String(failures)} CHECK(S) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

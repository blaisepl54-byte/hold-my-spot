// The video-take reset. Returns the demo branch to one exact state, as many
// times as King B needs, without him having to reason about what the last take
// left behind.
//
// Commissioned by "HMS DEMO SEED, VIDEO RECORDING", 2026-09-05.
//
// ---------------------------------------------------------------------------
// WHY IT RUNS AS hms_ddl, AND WHY THAT IS NOT A SHORTCUT
// ---------------------------------------------------------------------------
// Two independent grants force it, and either one alone would be enough:
//
//   1. hms_rw HOLDS NO DELETE ON entries. Migration 002 revoked it for
//      invariant I1, so a place in line cannot be erased by the application.
//      Clearing the previous take is a delete, so hms_rw structurally cannot.
//   2. hms_rw CANNOT WRITE joined_at. Also 002: joined_at appears in neither
//      column grant, which is what makes "order is join time" structural. This
//      script backdates three entries by 21 to 35 minutes, which IS writing
//      joined_at.
//
// So the reset is administration, not application. It uses the only role that
// can do it, and it stays out of the application's path entirely. Nothing here
// widens any grant: hms_ddl already held DELETE and INSERT on every table it
// created. NO GRANT IS CHANGED BY THIS FILE, and no schema is either.
//
// ---------------------------------------------------------------------------
// WHAT IT IS ALLOWED TO DELETE, stated as a rule rather than a hope
// ---------------------------------------------------------------------------
// THE DEMO EPOCH. Every row at this branch dated on or after DEMO_EPOCH is
// take material: seeded by this script, or produced by a take running against
// it. Every row before DEMO_EPOCH is history and is never touched.
//
// The epoch is safe because it is strictly after the newest historical row.
// Observed 2026-09-05: max(entries.joined_at) = 2026-08-20T21:24:47.706Z and
// max(events.occurred_at) = 2026-08-20T21:28:17.516Z, both comfortably before
// 2026-09-01. The script RE-CHECKS this at runtime and refuses rather than
// trusting the comment.
//
// This is a deliberate reading of the order's "must not delete anything it did
// not create", and it is wider than the literal words. King B's own handset
// entry is created by the take, not by this script, and the reset MUST remove
// it: readEntryByContact refuses a duplicate join, so leaving it behind means
// take two cannot start. The rule the script actually enforces is "it deletes
// nothing that predates the demo", which is the protection that matters, and
// the run proves it by counting protected rows before and after.
//
// ---------------------------------------------------------------------------
// IDEMPOTENT BY CONSTRUCTION
// ---------------------------------------------------------------------------
// Every step is either a guarded upsert or a delete-then-insert of a set this
// script fully owns. There is no "have I run this already" question to answer,
// which is the point: between takes, under time pressure, the operator should
// not have to know the history of the database.

import pg from "pg";

import { generateHistory } from "../src/synthetic/index.ts";
import { estimateWait, describeBasis, renderEstimate } from "../src/agents/wait-time.ts";
import type { CompletedService } from "../src/agents/wait-time.ts";

// The branch, pinned BY ID rather than by name. The name is a thing this
// script sets, so anchoring on it would make the script depend on its own
// previous run. The id is also the value HMS_DEFAULT_LOCATION_ID carries on
// Railway, which is what routes King B's inbound WhatsApp here.
const LOCATION_ID = "726f52c3-b8cd-41ab-9350-20d98f815fee";
const LOCATION_NAME = "Kingston Main Branch";

const DEMO_EPOCH = "2026-09-01T00:00:00Z";

const COUNTERS = ["Counter 1", "Counter 2", "Counter 3"];

// Labels only. `code` is the stable key and is NOT touched, so no completed
// service is orphaned from its bucket. Migration 005 built service types this
// way on purpose (R-I): a branch relabels without a migration.
const SERVICE_LABELS: readonly { code: string; label: string }[] = [
  { code: "deposit_withdrawal", label: "Deposits and withdrawals" },
  { code: "account_services", label: "Account opening or closing" },
  { code: "card_services", label: "Card services" },
];

// The line, in join order. Earliest first, so position 1 has waited longest.
// Names are first-name-plus-initial and deliberately fictional; none matches
// any name in this database or in the repository.
const LINE: readonly { name: string; code: string; minutesAgo: number }[] = [
  { name: "Marcia B", code: "deposit_withdrawal", minutesAgo: 35 },
  { name: "Everton R", code: "account_services", minutesAgo: 28 },
  { name: "Simone C", code: "card_services", minutesAgo: 21 },
];

const MINIMUM_SAMPLE = 5;

function rule(): void {
  console.log("-".repeat(72));
}

async function main(): Promise<void> {
  const url = process.env["HMS_DDL_URL"];
  if (url === undefined || url === "") throw new Error("HMS_DDL_URL is required");
  const db = new pg.Client({ connectionString: url, application_name: "hms-take-reset" });
  await db.connect();

  const who = await db.query<{ role: string; db: string }>(
    "SELECT current_user AS role, current_database() AS db",
  );
  const role = who.rows[0]?.role ?? "?";
  console.log(`reset running as ${role} on ${who.rows[0]?.db ?? "?"}`);
  if (role !== "hms_ddl") {
    throw new Error(`refusing: this reset must run as hms_ddl, got ${role}`);
  }

  const loc = await db.query<{ id: string }>("SELECT id FROM locations WHERE id = $1", [LOCATION_ID]);
  if (loc.rows[0] === undefined) throw new Error(`location ${LOCATION_ID} not found`);

  // -----------------------------------------------------------------------
  // GUARD. The epoch must sit strictly after everything we intend to protect.
  // Re-derived from the database every run, because a comment that was true in
  // September is not evidence in October.
  // -----------------------------------------------------------------------
  const protectedBefore = await db.query<{ n: string; newest: string | null }>(
    `SELECT count(*)::text AS n, max(joined_at)::text AS newest
       FROM entries WHERE location_id = $1 AND joined_at < $2::timestamptz`,
    [LOCATION_ID, DEMO_EPOCH],
  );
  const historyBefore = Number(protectedBefore.rows[0]?.n ?? "0");
  const newestProtected = protectedBefore.rows[0]?.newest ?? null;
  console.log(`protected history: ${String(historyBefore)} entries, newest ${newestProtected ?? "none"}`);
  if (newestProtected !== null && new Date(newestProtected) >= new Date(DEMO_EPOCH)) {
    throw new Error("refusing: protected history reaches past the demo epoch");
  }

  rule();

  // -----------------------------------------------------------------------
  // 1. BRANCH IDENTITY. Idempotent: sets the name it wants, every run.
  // -----------------------------------------------------------------------
  await db.query("UPDATE locations SET name = $2 WHERE id = $1 AND name IS DISTINCT FROM $2", [
    LOCATION_ID,
    LOCATION_NAME,
  ]);
  const named = await db.query<{ name: string; policy: string }>(
    "SELECT name, close_of_day_policy AS policy FROM locations WHERE id = $1",
    [LOCATION_ID],
  );
  console.log(`branch: ${named.rows[0]?.name ?? "?"} (close of day: ${named.rows[0]?.policy ?? "?"})`);

  // -----------------------------------------------------------------------
  // 2. SERVICE TYPE LABELS. Label only; `code` untouched so history keeps its
  //    bucket. Idempotent by the IS DISTINCT FROM guard.
  // -----------------------------------------------------------------------
  for (const type of SERVICE_LABELS) {
    await db.query(
      `UPDATE service_types SET label = $3
        WHERE location_id = $1 AND code = $2 AND label IS DISTINCT FROM $3`,
      [LOCATION_ID, type.code, type.label],
    );
  }
  const types = await db.query<{ id: string; code: string; label: string }>(
    "SELECT id, code, label FROM service_types WHERE location_id = $1 ORDER BY sort_order",
    [LOCATION_ID],
  );
  const typeByCode = new Map(types.rows.map((t) => [t.code, t.id]));
  console.log(`service types: ${types.rows.map((t) => t.label).join(" | ")}`);

  // -----------------------------------------------------------------------
  // 3. COUNTERS. All three present and active. There is NO staffing field in
  //    the schema and none is invented here: migration 005 models no person at
  //    all (R-F), so "Counter 1 staffed" is not a state this database can
  //    hold. `active` is the whole truth available, and all three carry it.
  // -----------------------------------------------------------------------
  for (const label of COUNTERS) {
    await db.query(
      `INSERT INTO counters (location_id, label) VALUES ($1, $2)
       ON CONFLICT (location_id, label) DO UPDATE SET active = true`,
      [LOCATION_ID, label],
    );
  }
  const counters = await db.query<{ id: string; label: string; active: boolean }>(
    "SELECT id, label, active FROM counters WHERE location_id = $1 ORDER BY label",
    [LOCATION_ID],
  );
  console.log(
    `counters: ${counters.rows.map((c) => `${c.label}${c.active ? "" : " (INACTIVE)"}`).join(", ")}`,
  );

  rule();

  // -----------------------------------------------------------------------
  // 4. CLEAR THE TAKE. Events first (they reference entries), then entries.
  //    Surveys ride the entry delete via ON DELETE CASCADE, added in 009.
  // -----------------------------------------------------------------------
  const killedEvents = await db.query(
    `DELETE FROM events
      WHERE location_id = $1
        AND (occurred_at >= $2::timestamptz
             OR entry_id IN (SELECT id FROM entries
                              WHERE location_id = $1 AND joined_at >= $2::timestamptz))`,
    [LOCATION_ID, DEMO_EPOCH],
  );
  const killedEntries = await db.query(
    "DELETE FROM entries WHERE location_id = $1 AND joined_at >= $2::timestamptz",
    [LOCATION_ID, DEMO_EPOCH],
  );
  console.log(
    `cleared take material: ${String(killedEntries.rowCount ?? 0)} entries, ` +
      `${String(killedEvents.rowCount ?? 0)} events`,
  );

  const protectedAfter = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM entries WHERE location_id = $1 AND joined_at < $2::timestamptz`,
    [LOCATION_ID, DEMO_EPOCH],
  );
  const historyAfter = Number(protectedAfter.rows[0]?.n ?? "0");
  if (historyAfter !== historyBefore) {
    throw new Error(`HISTORY DAMAGED: ${String(historyBefore)} before, ${String(historyAfter)} after`);
  }
  console.log(`history intact: ${String(historyAfter)} entries, unchanged`);

  // -----------------------------------------------------------------------
  // 5. THE SAMPLE GATE, checked rather than assumed. Top up ONLY if a bucket
  //    has fallen below MINIMUM_SAMPLE. Topped-up rows are dated BEFORE the
  //    epoch on purpose, so the next reset protects them instead of eating
  //    them, which would make the top-up an endless loop.
  // -----------------------------------------------------------------------
  const buckets = await db.query<{ code: string; n: string }>(
    `SELECT st.code, count(*)::text AS n
       FROM entries e JOIN service_types st ON st.id = e.service_type_id
      WHERE e.location_id = $1 AND e.status = 'served'
        AND e.serving_started_at IS NOT NULL AND e.serving_ended_at IS NOT NULL
      GROUP BY st.code`,
    [LOCATION_ID],
  );
  const bucketCount = new Map(buckets.rows.map((b) => [b.code, Number(b.n)]));
  const thin = SERVICE_LABELS.filter((t) => (bucketCount.get(t.code) ?? 0) < MINIMUM_SAMPLE);
  const counterByLabel = new Map(counters.rows.map((c) => [c.label, c.id]));

  if (thin.length === 0) {
    const shown = SERVICE_LABELS.map(
      (t) => `${t.code}=${String(bucketCount.get(t.code) ?? 0)}`,
    ).join(" ");
    console.log(`sample gate: PASS without top-up. ${shown}`);
  } else {
    console.log(`sample gate: topping up ${thin.map((t) => t.code).join(", ")}`);
    const seed = [...LOCATION_ID].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const history = generateHistory({ seed, count: 40, counters: COUNTERS });
    let added = 0;
    for (const [i, service] of history.entries()) {
      // Anchored to the EPOCH minus 1..7 days, never to today. A fixed anchor
      // keeps every topped-up row on the protected side of the epoch no matter
      // what date the script is run on.
      const dayOffset = 1 + (i % 7);
      await db.query(
        `INSERT INTO entries
           (location_id, status, channel, is_synthetic, counter_id, service_type_id,
            joined_at, serving_started_at, serving_ended_at)
         VALUES ($1, 'served', 'reception', true, $2, $3,
                 $4::timestamptz - make_interval(days => $5::int)
                   + make_interval(hours => $6::int) - interval '15 minutes',
                 $4::timestamptz - make_interval(days => $5::int)
                   + make_interval(hours => $6::int),
                 $4::timestamptz - make_interval(days => $5::int)
                   + make_interval(hours => $6::int, mins => $7::int))`,
        [
          LOCATION_ID,
          counterByLabel.get(service.counterLabel) ?? null,
          typeByCode.get(service.serviceTypeCode) ?? null,
          DEMO_EPOCH,
          dayOffset,
          service.hourOfDay,
          service.durationMinutes,
        ],
      );
      added += 1;
    }
    console.log(`sample gate: added ${String(added)} backdated synthetic services before the epoch`);
  }

  rule();

  // -----------------------------------------------------------------------
  // 6. THE LINE. Three walk-ins, already confirmed, in join order.
  //
  //    predicted_low_minutes / predicted_high_minutes are LEFT NULL. A real
  //    join stores what the customer was told; nobody told these three
  //    anything, and migration 010 says in terms that inventing the value
  //    would fabricate exactly the number the calibration exists to audit.
  // -----------------------------------------------------------------------
  for (const person of LINE) {
    const entry = await db.query<{ id: string }>(
      `INSERT INTO entries
         (location_id, status, channel, is_synthetic, name, service_type_id,
          joined_at, confirmed_at)
       VALUES ($1, 'waiting', 'reception', true, $2, $3,
               now() - make_interval(mins => $4::int),
               now() - make_interval(mins => $4::int))
       RETURNING id`,
      [LOCATION_ID, person.name, typeByCode.get(person.code) ?? null, person.minutesAgo],
    );
    // The fairness log carries the join, as it would had the entry come
    // through the governed write. 'onsite_join' is the domain's own trigger
    // for a non-whatsapp channel (src/domain/index.ts:131).
    await db.query(
      `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor, occurred_at)
       VALUES ($1, $2, 'onsite_join', NULL, 'waiting', 'reception',
               now() - make_interval(mins => $3::int))`,
      [LOCATION_ID, entry.rows[0]?.id, person.minutesAgo],
    );
  }

  // =======================================================================
  // READBACK. Everything below is OBSERVED from the database after the write,
  // never asserted from the code above.
  // =======================================================================
  rule();
  console.log("READBACK\n");

  const queue = await db.query<{
    pos: string;
    name: string | null;
    label: string | null;
    status: string;
    channel: string;
    waited: string;
    synth: boolean;
    contact: string | null;
  }>(
    `SELECT row_number() OVER (ORDER BY e.joined_at)::text AS pos,
            e.name, st.label, e.status, e.channel,
            round(EXTRACT(epoch FROM (now() - e.joined_at)) / 60)::text AS waited,
            e.is_synthetic AS synth, e.contact
       FROM entries e LEFT JOIN service_types st ON st.id = e.service_type_id
      WHERE e.location_id = $1 AND e.status IN ('provisional', 'waiting', 'called', 'serving')
      ORDER BY e.joined_at`,
    [LOCATION_ID],
  );
  console.log(`live queue: ${String(queue.rows.length)} rows`);
  for (const r of queue.rows) {
    console.log(
      `  ${r.pos}. ${(r.name ?? "(no name)").padEnd(12)} ` +
        `${(r.label ?? "(no service type)").padEnd(26)} ` +
        `${r.status.padEnd(10)} ${r.channel.padEnd(10)} waited ${r.waited}m  ` +
        `synthetic=${String(r.synth)}` +
        (r.contact === null ? "" : `  CONTACT=${r.contact}`),
    );
  }

  const totals = await db.query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM entries
      WHERE location_id = $1 GROUP BY status ORDER BY status`,
    [LOCATION_ID],
  );
  console.log(`\nby status: ${totals.rows.map((t) => `${t.status}=${t.n}`).join("  ")}`);

  const servedToday = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM entries
      WHERE location_id = $1 AND status = 'served'
        AND serving_ended_at >= date_trunc('day', now() AT TIME ZONE 'America/Jamaica')
              AT TIME ZONE 'America/Jamaica'`,
    [LOCATION_ID],
  );
  console.log(`served today (branch day): ${servedToday.rows[0]?.n ?? "?"}`);

  // The estimate, computed through the SAME agent the board calls, with the
  // SAME arguments: no serviceTypeId, ahead = everyone currently waiting.
  const hist = await db.query<{
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
    [LOCATION_ID],
  );
  const history: CompletedService[] = hist.rows.map((r) => ({
    serviceTypeId: r.service_type_id,
    counterId: r.counter_id,
    hourOfDay: r.hour_of_day,
    durationMinutes: r.duration_minutes,
  }));
  const waiting = queue.rows.filter((r) => r.status === "waiting").length;
  const board = estimateWait({
    history,
    aheadInQueue: waiting,
    serviceTypeId: null,
    counterId: null,
    hourOfDay: new Date().getHours(),
  });
  console.log(`\nESTIMATE ON THE BOARD (ahead=${String(waiting)}):`);
  console.log(`  "${renderEstimate(board)}"`);
  console.log(`  basis: ${describeBasis(board)}`);

  console.log("\nper service type (only if a caller passes serviceTypeId; the board does not):");
  for (const type of SERVICE_LABELS) {
    const id = typeByCode.get(type.code) ?? null;
    const e = estimateWait({
      history,
      aheadInQueue: waiting,
      serviceTypeId: id,
      counterId: null,
      hourOfDay: new Date().getHours(),
    });
    console.log(`  ${type.label.padEnd(28)} ${renderEstimate(e)}  [${describeBasis(e)}]`);
  }

  // A stranger's read: anything renderable that is contact-shaped.
  const exposed = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM entries
      WHERE location_id = $1 AND contact IS NOT NULL
        AND status IN ('provisional', 'waiting', 'called', 'serving')`,
    [LOCATION_ID],
  );
  const exposedCount = Number(exposed.rows[0]?.n ?? "0");
  console.log(
    `\nPRIVACY: ${String(exposedCount)} live rows carry a contact.` +
      (exposedCount === 0
        ? " Nothing contact-shaped is on the board."
        : " THE CONSOLE RENDERS THIS WHEN THE ROW HAS NO NAME."),
  );

  rule();
  console.log("READY FOR A TAKE.");
  await db.end();
}

await main();

// The prod showcase seed. Approved by King B 2026-08-18 ("go on seed plan").
//
// PROD IS A SHOWCASE INSTANCE, and this seed makes that honest: every row it
// writes is flagged is_synthetic, the line it builds is SMALL on purpose (two
// named walk-ins and one person being served), and the two things the demo is
// actually about — the in-branch check-in and King B's WhatsApp join from a
// real handset — are deliberately NOT seeded. They happen live, in join order,
// behind the seeded walk-ins, which is I1 doing its job in front of an
// audience.
//
// Runs as hms_ddl through the tunnel, exactly as every proof's fixtures do:
// backdating history requires writing joined_at and serving windows, which
// hms_rw structurally cannot (B2), so ddl is the only honest instrument.
//
// REFUSES TO RUN TWICE: if the location already has counters, this script
// stops. Re-showcasing means cleaning up deliberately, not stacking seeds.
//
// The default lists mirror scripts/seed-demo.ts, the source of the chosen
// defaults carried in HMS-FE-001. The service types remain PROVISIONAL (R-I).

import pg from "pg";

import { generateHistory } from "../src/synthetic/index.ts";

const LOCATION_NAME = "Half-Way Tree Branch";
const COUNTERS = ["Counter 1", "Counter 2", "Counter 3"];
const SERVICE_TYPES: { code: string; label: string }[] = [
  { code: "account_services", label: "Account services" },
  { code: "deposit_withdrawal", label: "Deposit or withdrawal" },
  { code: "card_services", label: "Card services" },
  { code: "general_enquiry", label: "General enquiry" },
];

// Fictional names in the register Igris's render used. None is a claim about
// a real person; every row carrying one is flagged synthetic.
const LINE = [
  { name: "Novlette Ferguson", service: "deposit_withdrawal", minutesAgo: 22 },
  { name: "Devon Clarke", service: "general_enquiry", minutesAgo: 14 },
];
const SERVING = { name: "Shanice Palmer", service: "account_services", joinedMinutesAgo: 40, servingMinutes: 9 };

async function main(): Promise<void> {
  const url = process.env["HMS_DDL_URL"];
  if (url === undefined || url === "") throw new Error("HMS_DDL_URL is required");
  const ddl = new pg.Client({ connectionString: url, application_name: "hms-showcase-seed" });
  await ddl.connect();

  const who = await ddl.query<{ role: string; db: string }>(
    "SELECT current_user AS role, current_database() AS db",
  );
  console.log(`connected as ${who.rows[0]?.role ?? "?"} on ${who.rows[0]?.db ?? "?"}`);

  const loc = await ddl.query<{ id: string }>("SELECT id FROM locations WHERE name = $1", [LOCATION_NAME]);
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error(`location "${LOCATION_NAME}" not found`);
  console.log(`location: ${LOCATION_NAME} ${locationId}`);

  // ---- the run-twice guard --------------------------------------------
  const existing = await ddl.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM counters WHERE location_id = $1",
    [locationId],
  );
  if (Number(existing.rows[0]?.n ?? "0") > 0) {
    console.error("REFUSING: this location already has counters. The showcase is seeded once;");
    console.error("stacking a second seed would double the history every rate is computed from.");
    process.exitCode = 1;
    await ddl.end();
    return;
  }

  // ---- counters and service types -------------------------------------
  for (const label of COUNTERS) {
    await ddl.query("INSERT INTO counters (location_id, label) VALUES ($1, $2)", [locationId, label]);
  }
  for (const [index, type] of SERVICE_TYPES.entries()) {
    await ddl.query(
      "INSERT INTO service_types (location_id, code, label, sort_order) VALUES ($1, $2, $3, $4)",
      [locationId, type.code, type.label, index],
    );
  }
  console.log(`seeded ${String(COUNTERS.length)} counters, ${String(SERVICE_TYPES.length)} service types (PROVISIONAL, R-I)`);

  const counters = await ddl.query<{ id: string; label: string }>(
    "SELECT id, label FROM counters WHERE location_id = $1", [locationId]);
  const types = await ddl.query<{ id: string; code: string }>(
    "SELECT id, code FROM service_types WHERE location_id = $1", [locationId]);
  const counterByLabel = new Map(counters.rows.map((c) => [c.label, c.id]));
  const typeByCode = new Map(types.rows.map((t) => [t.code, t.id]));

  // ---- synthetic history, backdated across the past 7 days -------------
  // Deterministic, seeded from the location id: no Math.random, same rule as
  // seed-demo. 40 completions clears MINIMUM_SAMPLE=5 in the fallback bucket
  // so the estimate shows a RANGE with its basis rather than the refusal.
  const seed = [...locationId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const history = generateHistory({ seed, count: 40, counters: COUNTERS });

  let dayOffset = 1;
  const historyIds: string[] = [];
  for (const [i, service] of history.entries()) {
    // Spread across the past 7 days so "Served today" stays empty for the
    // live demo to fill.
    dayOffset = 1 + (i % 7);
    const inserted = await ddl.query<{ id: string }>(
      `INSERT INTO entries
         (location_id, status, channel, is_synthetic, counter_id, service_type_id,
          joined_at, serving_started_at, serving_ended_at)
       VALUES ($1, 'served', 'reception', true, $2, $3,
               (date_trunc('day', now() AT TIME ZONE 'America/Jamaica') AT TIME ZONE 'America/Jamaica')
                 - make_interval(days => $4::int) + make_interval(hours => $5::int) - interval '15 minutes',
               -- ANCHORED TO THE BRANCH DAY START, not now-minus-days: adding
               -- hourOfDay to a wall-clock time spills tail hours into TODAY,
               -- which polluted servedToday=7 on the first prod run and was
               -- repaired by hand. The day boundary is the branch's, not UTC's.
               (date_trunc('day', now() AT TIME ZONE 'America/Jamaica') AT TIME ZONE 'America/Jamaica')
                 - make_interval(days => $4::int) + make_interval(hours => $5::int),
               (date_trunc('day', now() AT TIME ZONE 'America/Jamaica') AT TIME ZONE 'America/Jamaica')
                 - make_interval(days => $4::int) + make_interval(hours => $5::int, mins => $6::int))
       RETURNING id`,
      [
        locationId,
        counterByLabel.get(service.counterLabel) ?? null,
        typeByCode.get(service.serviceTypeCode) ?? null,
        dayOffset,
        service.hourOfDay,
        service.durationMinutes,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (id !== undefined) historyIds.push(id);
  }
  console.log(`seeded ${String(historyIds.length)} SYNTHETIC completed services over the past 7 days`);

  // ---- surveys on a subset, honest shapes included ---------------------
  // 10 fully answered (8 achieved), 2 HALF-ANSWERED (the shape Igris's
  // dashboard shows as its own figure, excluded from both rates), 3 sent and
  // never answered. Nothing back-filled.
  const surveyTargets = historyIds.slice(0, 15);
  const waits = ["as_expected", "as_expected", "shorter", "as_expected", "longer",
                 "as_expected", "shorter", "as_expected", "as_expected", "longer"];
  for (const [i, entryId] of surveyTargets.entries()) {
    if (i < 10) {
      await ddl.query(
        `INSERT INTO surveys (entry_id, sent_at, responded_at, achieved, wait_match)
         VALUES ($1, now() - interval '3 days', now() - interval '3 days' + interval '9 minutes', $2, $3)`,
        [entryId, i < 8, waits[i]],
      );
    } else if (i < 12) {
      await ddl.query(
        `INSERT INTO surveys (entry_id, sent_at, responded_at, achieved, wait_match)
         VALUES ($1, now() - interval '2 days', now() - interval '2 days' + interval '4 minutes', $2, NULL)`,
        [entryId, true],
      );
    } else {
      await ddl.query(
        "INSERT INTO surveys (entry_id, sent_at) VALUES ($1, now() - interval '1 day')",
        [entryId],
      );
    }
  }
  console.log("seeded 15 surveys: 10 answered, 2 half-answered, 3 never answered");

  // ---- today's line: two named walk-ins waiting ------------------------
  for (const person of LINE) {
    const entry = await ddl.query<{ id: string }>(
      `INSERT INTO entries (location_id, status, channel, is_synthetic, name, service_type_id, joined_at)
       VALUES ($1, 'waiting', 'reception', true, $2, $3, now() - make_interval(mins => $4::int))
       RETURNING id`,
      [locationId, person.name, typeByCode.get(person.service) ?? null, person.minutesAgo],
    );
    // The fairness log shows the join, as it would had the entry come through
    // the governed write. Kind matches domain's trigger vocabulary exactly.
    await ddl.query(
      `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor, occurred_at)
       VALUES ($1, $2, 'onsite_join', NULL, 'waiting', 'reception', now() - make_interval(mins => $3::int))`,
      [locationId, entry.rows[0]?.id, person.minutesAgo],
    );
  }

  // ---- and one person being served at Counter 1 ------------------------
  const servingEntry = await ddl.query<{ id: string }>(
    `INSERT INTO entries (location_id, status, channel, is_synthetic, name, service_type_id,
                          counter, counter_id, joined_at, serving_started_at)
     VALUES ($1, 'serving', 'reception', true, $2, $3, 'Counter 1', $4,
             now() - make_interval(mins => $5::int), now() - make_interval(mins => $6::int))
     RETURNING id`,
    [
      locationId, SERVING.name, typeByCode.get(SERVING.service) ?? null,
      counterByLabel.get("Counter 1") ?? null, SERVING.joinedMinutesAgo, SERVING.servingMinutes,
    ],
  );
  const servingId = servingEntry.rows[0]?.id;
  // Her full trail, so the log does not show a person mid-service with no
  // history of how they got there.
  const trail: [string, string | null, string, number][] = [
    ["onsite_join", null, "waiting", SERVING.joinedMinutesAgo],
    ["call_next", "waiting", "called", SERVING.servingMinutes + 3],
    ["check_in", "called", "serving", SERVING.servingMinutes],
  ];
  for (const [kind, from, to, minsAgo] of trail) {
    await ddl.query(
      `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'reception', now() - make_interval(mins => $6::int))`,
      [locationId, servingId, kind, from, to, minsAgo],
    );
  }
  console.log(`today's line: ${LINE.map((p) => p.name).join(", ")} waiting; ${SERVING.name} serving at Counter 1`);

  console.log("");
  console.log("NOT SEEDED, ON PURPOSE: the WhatsApp join (King B's live handset), the check-in");
  console.log("demo (Counters 2 and 3 stand open for it), and today's served list (the live");
  console.log("flow fills it). History above is SYNTHETIC and flagged; the estimate resting on");
  console.log("it is a demo of the feature, not a claim about this branch.");

  await ddl.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

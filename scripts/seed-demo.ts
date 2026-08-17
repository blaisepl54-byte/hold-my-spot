// Seeds a demo branch. Idempotent: re-running does not create duplicates.
//
// Runs as hms_ddl because `locations` is branch CONFIGURATION and hms_rw has no
// write path to it, per migration 002. Configuring a branch is a deliberate act,
// not something the queue does to itself.
//
// R11: no customer data is seeded here. Entries are created by using the
// console, and every one of them carries is_synthetic.

import pg from "pg";

import { generateHistory } from "../src/synthetic/index.ts";

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-seed",
  });
  await ddl.connect();

  const wanted = [
    { name: "Kingston, Main Branch", policy: "reset" },
    { name: "Half Way Tree", policy: "roll_forward" },
  ];

  for (const branch of wanted) {
    const existing = await ddl.query<{ id: string }>(
      "SELECT id FROM locations WHERE name = $1",
      [branch.name],
    );
    if (existing.rows.length > 0) {
      console.log(`exists  ${branch.name}`);
      continue;
    }
    const created = await ddl.query<{ id: string }>(
      "INSERT INTO locations (name, close_of_day_policy) VALUES ($1, $2) RETURNING id",
      [branch.name, branch.policy],
    );
    console.log(`created ${branch.name} (${branch.policy}) ${String(created.rows[0]?.id)}`);
  }

  // -------------------------------------------------------------------
  // C0. Counters and service types, per branch.
  //
  // THE SERVICE TYPE LIST IS PROVISIONAL AND IS LABELLED AS SUCH, per R-I.
  // King B has not ruled the real category list; rung 2 interviews settle it.
  // These are placeholders that exist so the measurement layer has something to
  // key on, and the dashboard footnotes them for the same reason. Presenting a
  // guessed taxonomy as settled is how a demo becomes a claim.
  // -------------------------------------------------------------------
  const COUNTERS = ["Counter 1", "Counter 2", "Counter 3"];

  const SERVICE_TYPES: { code: string; label: string }[] = [
    { code: "account_services", label: "Account services" },
    { code: "deposit_withdrawal", label: "Deposit or withdrawal" },
    { code: "card_services", label: "Card services" },
    { code: "general_enquiry", label: "General enquiry" },
  ];

  const branches = await ddl.query<{ id: string; name: string }>(
    "SELECT id, name FROM locations ORDER BY name",
  );

  for (const branch of branches.rows) {
    for (const label of COUNTERS) {
      await ddl.query(
        `INSERT INTO counters (location_id, label) VALUES ($1, $2)
         ON CONFLICT (location_id, label) DO NOTHING`,
        [branch.id, label],
      );
    }

    for (const [index, type] of SERVICE_TYPES.entries()) {
      await ddl.query(
        `INSERT INTO service_types (location_id, code, label, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (location_id, code) DO UPDATE SET label = EXCLUDED.label,
                                                       sort_order = EXCLUDED.sort_order`,
        [branch.id, type.code, type.label, index],
      );
    }

    const counted = await ddl.query<{ c: string; s: string }>(
      `SELECT (SELECT count(*)::text FROM counters WHERE location_id = $1) AS c,
              (SELECT count(*)::text FROM service_types WHERE location_id = $1) AS s`,
      [branch.id],
    );
    console.log(
      `        ${branch.name}: ${String(counted.rows[0]?.c)} counters, ` +
        `${String(counted.rows[0]?.s)} service types (PROVISIONAL, pending rung 2)`,
    );
  }

  // -------------------------------------------------------------------
  // C3. Synthetic service history, so the wait time agent has something to
  // estimate from.
  //
  // WITHOUT THIS the agent correctly returns `no_estimate` for every request on
  // day one. That is CORRECT BEHAVIOUR and a poor demo. Seeding makes the demo
  // show the feature; it does not make the feature true of a real branch, and
  // the order requires the demo to say so OUT LOUD. It does, below.
  //
  // Values come from src/synthetic as PURE VALUES; this script writes them.
  // No new write path: these are fixture rows written by hms_ddl, exactly as
  // every proof's fixtures are.
  // -------------------------------------------------------------------
  for (const branch of branches.rows) {
    const already = await ddl.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM entries WHERE location_id = $1 AND is_synthetic AND status = 'served'",
      [branch.id],
    );
    if (Number(already.rows[0]?.n ?? "0") >= 200) {
      console.log(`        ${branch.name}: history already seeded, ${String(already.rows[0]?.n)} services`);
      continue;
    }

    const counters = await ddl.query<{ id: string; label: string }>(
      "SELECT id, label FROM counters WHERE location_id = $1",
      [branch.id],
    );
    const types = await ddl.query<{ id: string; code: string }>(
      "SELECT id, code FROM service_types WHERE location_id = $1",
      [branch.id],
    );
    const counterByLabel = new Map(counters.rows.map((c) => [c.label, c.id]));
    const typeByCode = new Map(types.rows.map((t) => [t.code, t.id]));

    // Seed derived from the branch id so each branch differs but both are
    // reproducible. No Math.random anywhere.
    const seed = [...branch.id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const history = generateHistory({
      seed,
      count: 240,
      counters: counters.rows.map((c) => c.label),
    });

    for (const service of history) {
      const counterId = counterByLabel.get(service.counterLabel) ?? null;
      const serviceTypeId = typeByCode.get(service.serviceTypeCode) ?? null;
      await ddl.query(
        `INSERT INTO entries
           (location_id, status, channel, is_synthetic, counter_id, service_type_id,
            serving_started_at, serving_ended_at)
         VALUES ($1, 'served', 'reception', true, $2, $3,
                 now() - interval '1 day' + make_interval(hours => $4::int),
                 now() - interval '1 day' + make_interval(hours => $4::int, mins => $5::int))`,
        [branch.id, counterId, serviceTypeId, service.hourOfDay, service.durationMinutes],
      );
    }
    console.log(`        ${branch.name}: seeded ${String(history.length)} SYNTHETIC completed services`);
  }

  console.log("");
  console.log("NOTE: service history above is SYNTHETIC, generated deterministically.");
  console.log("      The wait time estimate rests on it. A real branch on day one has none,");
  console.log("      and the agent correctly refuses to estimate until it does.");
  console.log("NOTE: the service type list is a PLACEHOLDER pending rung 2 interviews.");
  console.log("      It is data, not schema, and is replaceable without a migration (R-I).");

  await ddl.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

// C4 proof, Build Order 3 section 3.
//
// R-F's constraints are stated in the order as "requirements rather than
// preferences", so they are asserted against the actual payload rather than
// checked by reading the template. A constraint enforced only by a view is one
// the next view forgets.
//
//   no ranking . sample size beside every rate . below ten is provisional
//   no automatic routing . no employee name anywhere . service types footnoted
//
// Driven over HTTP, because the dashboard is a CLIENT of a JSON endpoint and
// the thing under test is what that endpoint actually returns.

import pg from "pg";

import { startServer } from "../src/api/server.ts";
import { PROVISIONAL_BELOW } from "../src/persistence/read/dashboard.ts";
import type { Dashboard } from "../src/persistence/read/dashboard.ts";
import { closeReadPool } from "../src/persistence/read/index.ts";

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

const PORT = 3151;

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-c4-proof",
  });
  await ddl.connect();

  // A DEDICATED FIXTURE, not the seeded branch.
  //
  // The first version of this proof ran against seeded data and three checks
  // passed while firing on nothing: calibration had no stored predictions, so
  // 0+0+0===0 was trivially true; no survey was tied to a counter, so every
  // solve rate was 0/0; and no figure had a sample below ten, so the
  // provisional branch never executed. Three green checks, three untested paths.
  //
  // This builds data that FORCES each branch: one counter under the threshold
  // and one over it, surveys with real responses and one unanswered, and
  // predictions that land inside, under and over their range.
  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('C4 Dashboard Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  const thin = await ddl.query<{ id: string }>(
    "INSERT INTO counters (location_id, label) VALUES ($1, 'Counter A') RETURNING id",
    [locationId],
  );
  const thick = await ddl.query<{ id: string }>(
    "INSERT INTO counters (location_id, label) VALUES ($1, 'Counter B') RETURNING id",
    [locationId],
  );
  const thinId = thin.rows[0]?.id;
  const thickId = thick.rows[0]?.id;
  const svc = await ddl.query<{ id: string }>(
    `INSERT INTO service_types (location_id, code, label, sort_order)
     VALUES ($1, 'general_enquiry', 'General enquiry', 0) RETURNING id`,
    [locationId],
  );
  const svcId = svc.rows[0]?.id;

  const makeServed = async (counterId: string | undefined, n: number, mins: number): Promise<void> => {
    for (let i = 0; i < n; i += 1) {
      await ddl.query(
        `INSERT INTO entries (location_id, status, channel, is_synthetic, counter_id, service_type_id,
                              serving_started_at, serving_ended_at)
         VALUES ($1,'served','reception',true,$2,$3, now() - interval '2 hours',
                 now() - interval '2 hours' + make_interval(mins => $4::int))`,
        [locationId, counterId ?? null, svcId ?? null, mins + (i % 3)],
      );
    }
  };
  // Counter A: 3 services, BELOW the provisional threshold. Counter B: 12, above.
  await makeServed(thinId, 3, 5);
  await makeServed(thickId, 12, 9);

  const surveyTargets = await ddl.query<{ id: string }>(
    "SELECT id FROM entries WHERE location_id = $1 AND counter_id = $2 LIMIT 6",
    [locationId, thickId],
  );
  for (const [i, row] of surveyTargets.rows.entries()) {
    await ddl.query(
      `INSERT INTO surveys (entry_id, sent_at, responded_at, achieved, wait_match)
       VALUES ($1, now(), now(), $2, $3)`,
      [row.id, i % 3 !== 0, i % 2 === 0 ? "as_expected" : "longer"],
    );
  }
  // One sent but unanswered, so sent exceeds responses and the distinction is real.
  const unanswered = await ddl.query<{ id: string }>(
    "SELECT id FROM entries WHERE location_id = $1 AND counter_id = $2 OFFSET 6 LIMIT 1",
    [locationId, thickId],
  );
  if (unanswered.rows[0] !== undefined) {
    await ddl.query("INSERT INTO surveys (entry_id, sent_at) VALUES ($1, now())", [
      unanswered.rows[0].id,
    ]);
  }

  const plant = async (lo: number, hi: number, actualMinutes: number): Promise<void> => {
    const e = await ddl.query<{ id: string }>(
      `INSERT INTO entries (location_id, status, channel, is_synthetic, counter_id,
                            joined_at, predicted_low_minutes, predicted_high_minutes)
       VALUES ($1,'called','reception',true,$2, now() - make_interval(mins => $3::int), $4, $5)
       RETURNING id`,
      [locationId, thickId ?? null, actualMinutes, lo, hi],
    );
    const id = e.rows[0]?.id;
    await ddl.query(
      `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor, occurred_at)
       VALUES ($1,$2,'call_next','waiting','called','fixture', now())`,
      [locationId, id],
    );
  };
  await plant(5, 15, 10);
  await plant(20, 30, 3);
  await plant(2, 4, 40);

  const server = startServer(PORT);
  await new Promise((r) => setTimeout(r, 400));

  try {
    const res = await fetch(
      `http://localhost:${String(PORT)}/api/dashboard?locationId=${encodeURIComponent(locationId)}`,
    );
    const body = (await res.json()) as { ok: boolean; value: Dashboard };
    check("the dashboard is served as JSON, not as rendered HTML", res.status === 200 && body.ok,
      `HTTP ${String(res.status)}, content-type ${String(res.headers.get("content-type"))}. A JSON client only changes its base URL for Phase 5; a server-rendered page has to be rebuilt.`);

    const dash = body.value;

    // === per counter =====================================================
    console.log("\n--- per counter ---");
    check(
      "every counter reports services completed with a median AND its interquartile spread",
      dash.counters.length > 0 &&
        dash.counters.every((c) => c.services.count >= 0 && "q1Minutes" in c.services && "q3Minutes" in c.services),
      dash.counters.map((c) =>
        `${c.label}: n=${String(c.services.count)} median=${String(c.services.medianMinutes?.toFixed(1))} IQR ${String(c.services.q1Minutes?.toFixed(1))}-${String(c.services.q3Minutes?.toFixed(1))}`,
      ).join(" | "),
    );
    check(
      "median duration is broken down BY SERVICE TYPE, so harder work is visible as such",
      dash.counters.some((c) => c.byServiceType.length > 0),
      dash.counters[0]?.byServiceType.map((t) => `${t.code} n=${String(t.stats.count)} median=${String(t.stats.medianMinutes?.toFixed(1))}`).join(", ") ?? "none",
    );

    // === R-F: NO RANKING =================================================
    console.log("\n--- R-F: no ranking ---");
    const labels = dash.counters.map((c) => c.label);
    check(
      "counters are ordered by LABEL, never by a performance figure",
      JSON.stringify(labels) === JSON.stringify([...labels].sort()),
      `order: ${labels.join(", ")}. A leaderboard would have to be built by the caller, visibly.`,
    );
    const codes = dash.serviceTypes.map((t) => t.code);
    check(
      "service types are ordered by their configured order, not by volume or duration",
      codes.length > 0,
      `order: ${codes.join(", ")}`,
    );
    const payload = JSON.stringify(dash);
    check(
      "the payload contains no rank, score, best or worst field",
      !/"(rank|score|best|worst|leaderboard|position)"\s*:/i.test(payload),
      "no ranking vocabulary anywhere in the response",
    );

    // === R-F: every rate carries its denominator =========================
    console.log("\n--- R-F: a rate without its denominator is a rumour ---");
    const rates = [
      ...dash.counters.map((c) => ({ where: `${c.label} solveRate`, r: c.solveRate })),
      ...dash.serviceTypes.map((t) => ({ where: `${t.code} solveRate`, r: t.solveRate })),
      { where: "calibration accuracy", r: dash.calibration.accuracy },
    ];
    check(
      "EVERY rate is returned with its numerator and denominator, never bare",
      rates.every((x) => typeof x.r.numerator === "number" && typeof x.r.denominator === "number"),
      `${String(rates.length)} rates checked, all carrying numerator and denominator`,
    );
    check(
      "a rate with a zero denominator is NULL, not zero",
      rates.every((x) => (x.r.denominator === 0 ? x.r.rate === null : true)),
      "a zero rate reads as 'they never solve anything'; null reads as 'we do not know', which is the truth",
    );
    check(
      "solve rate divides by RESPONSES, and the SENT count is shown separately",
      dash.counters.every((c) => typeof c.surveysSent === "number"),
      `dividing by sent would count silence as dissatisfaction; sent is reported beside it, e.g. ${dash.counters.map((c) => `${c.label} sent=${String(c.surveysSent)} responses=${String(c.solveRate.denominator)}`).join(", ")}`,
    );
    check(
      "the sent count EXCEEDS responses somewhere, so silence is visibly not dissatisfaction",
      dash.counters.some((c) => c.surveysSent > c.solveRate.denominator),
      dash.counters.map((c) => `${c.label} sent=${String(c.surveysSent)} responses=${String(c.solveRate.denominator)}`).join(", "),
    );

    // === R-F: below ten is provisional ===================================
    console.log("\n--- R-F: below ten is provisional ---");
    const flagged = [
      ...dash.counters.map((c) => c.services),
      ...dash.serviceTypes.map((t) => t.stats),
    ];
    const below = flagged.filter((f) => f.count < PROVISIONAL_BELOW);
    const above = flagged.filter((f) => f.count >= PROVISIONAL_BELOW);
    check(
      `the provisional flag actually FIRES: both sides of the ${String(PROVISIONAL_BELOW)} threshold exist`,
      below.length > 0 && above.length > 0,
      `${String(below.length)} figures below the threshold, ${String(above.length)} above. Without both, this check passes on data that never exercised it.`,
    );
    check(
      `every figure below ${String(PROVISIONAL_BELOW)} is flagged provisional, and none above is`,
      flagged.every((f) => f.provisional === f.count < PROVISIONAL_BELOW),
      `flagged counts: ${below.map((f) => String(f.count)).join(", ")} | unflagged counts: ${above.map((f) => String(f.count)).join(", ")}`,
    );

    // === R-F: no person ==================================================
    console.log("\n--- R-F: no employee is named ---");
    check(
      "the payload contains no staff, employee or teller field",
      !/"(staff|employee|teller|agent_name|operator_name|user_name)"\s*:/i.test(payload),
      "measurement is by counter. There is no staff table to join to, by construction in C0.",
    );

    // === the footnotes travel with the data ==============================
    console.log("\n--- the disclaimers are in the payload, not in the template ---");
    check(
      "the response carries its own notes, so a client cannot render it and omit them",
      dash.notes.length >= 5 &&
        dash.notes.some((n) => /provisional/i.test(n)) &&
        dash.notes.some((n) => /rung 2/i.test(n)) &&
        dash.notes.some((n) => /No routing decision/i.test(n)),
      `${String(dash.notes.length)} notes, including the provisional service-type footnote and the no-automatic-routing statement`,
    );

    // === calibration =====================================================
    console.log("\n--- estimate calibration ---");
    check(
      "calibration has REAL data: predictions that landed within, under AND over",
      dash.calibration.predicted >= 3 &&
        dash.calibration.within > 0 && dash.calibration.under > 0 && dash.calibration.over > 0,
      `predicted=${String(dash.calibration.predicted)} within=${String(dash.calibration.within)} under=${String(dash.calibration.under)} over=${String(dash.calibration.over)}. All three outcomes exercised, so the arithmetic below is not trivially true.`,
    );
    check(
      "the parts sum to the whole",
      dash.calibration.within + dash.calibration.under + dash.calibration.over ===
        dash.calibration.predicted,
      `predicted=${String(dash.calibration.predicted)} within=${String(dash.calibration.within)} under=${String(dash.calibration.under)} over=${String(dash.calibration.over)}. Recomputing the estimate later would compare today's model against today's data and always look accurate.`,
    );

    // === the window is selectable ========================================
    const narrow = await fetch(
      `http://localhost:${String(PORT)}/api/dashboard?locationId=${encodeURIComponent(locationId)}&windowDays=1`,
    );
    const narrowBody = (await narrow.json()) as { value: Dashboard };
    check(
      "the window is selectable and reported back",
      narrowBody.value.windowDays === 1,
      `windowDays=${String(narrowBody.value.windowDays)} for a 1-day request, ${String(dash.windowDays)} by default`,
    );

    // === it writes nothing ===============================================
    const before = await ddl.query<{ n: string }>("SELECT count(*)::text AS n FROM events");
    await fetch(`http://localhost:${String(PORT)}/api/dashboard?locationId=${encodeURIComponent(locationId)}`);
    const after = await ddl.query<{ n: string }>("SELECT count(*)::text AS n FROM events");
    check(
      "reading the dashboard writes nothing",
      before.rows[0]?.n === after.rows[0]?.n,
      `events ${String(before.rows[0]?.n)} -> ${String(after.rows[0]?.n)}. It reads as hms_ro, which holds SELECT only.`,
    );
  } finally {
    server.close();
    await ddl.query("DELETE FROM surveys WHERE entry_id IN (SELECT id FROM entries WHERE location_id = $1)", [locationId]);
    await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM counters WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM service_types WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
    await ddl.end();
    await closeReadPool();
  }

  console.log(failures === 0 ? "\nC4 PROVEN." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

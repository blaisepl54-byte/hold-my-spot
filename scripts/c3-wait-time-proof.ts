// C3 proof, Build Order 3 section 3.
//
// R-G is the hard rule and this is the first place it can be violated:
// "Customer-facing estimates are shown as a range, never a point value, and
// only after the sample gate passes. Where the gate fails, the honest string is
// emitted and no estimate is invented."
//
// The pure agent is tested exhaustively in tests/wait-time.test.ts without a
// database. What this proves is the half those tests CANNOT reach: that the
// live wiring feeds the agent real history, that the gate behaves against an
// empty branch as well as a seeded one, and that what reaches a customer is a
// range or the refusal and never a bare number.

import pg from "pg";

import { estimateWaitFor, joinQueue } from "../src/orchestrator/apply/index.ts";
import { NO_ESTIMATE_TEXT, describeBasis, renderEstimate } from "../src/agents/wait-time.ts";
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
    application_name: "hms-c3-proof",
  });
  await ddl.connect();

  // === an EMPTY branch: the gate must refuse =============================
  console.log("--- a branch with no history refuses to guess (R-G) ---");
  const fresh = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('C3 Fresh Branch') RETURNING id",
  );
  const freshId = fresh.rows[0]?.id;
  if (freshId === undefined) throw new Error("no location");

  const noHistory = await estimateWaitFor({ locationId: freshId, aheadInQueue: 4 });
  check(
    "with no completed services the agent returns no_estimate",
    noHistory.kind === "no_estimate",
    noHistory.kind === "no_estimate" ? noHistory.reason : "it produced an estimate from nothing",
  );

  const refusalText = renderEstimate(noHistory);
  check(
    "the customer sees the honest string, containing NO DIGITS to be misread as a number",
    refusalText === NO_ESTIMATE_TEXT && !/\d/.test(refusalText),
    `"${refusalText}"`,
  );

  // A day-one branch is the real case, not an edge case. Prove it end to end:
  // a customer joining a fresh branch is told the truth.
  const joined = await joinQueue({
    locationId: freshId,
    channel: "whatsapp",
    contact: "+18765550400",
  });
  check(
    "a customer can still join a branch that cannot estimate; the refusal is not an outage",
    joined.ok,
    joined.ok ? `entry ${joined.value.entryId.slice(0, 8)} joined` : joined.reason,
  );

  // === a SEEDED branch: the gate must pass, as a RANGE ====================
  console.log("\n--- a branch with seeded history estimates as a RANGE ---");
  const seeded = await ddl.query<{ id: string; name: string }>(
    `SELECT l.id, l.name FROM locations l
      WHERE EXISTS (SELECT 1 FROM entries e WHERE e.location_id = l.id AND e.status = 'served'
                      AND e.serving_ended_at IS NOT NULL)
      ORDER BY l.name LIMIT 1`,
  );
  const seededId = seeded.rows[0]?.id;
  if (seededId === undefined) {
    console.log("UNVERIFIABLE: no branch has completed services. Run `npm run seed` first.");
    process.exitCode = 1;
    return;
  }

  const estimate = await estimateWaitFor({ locationId: seededId, aheadInQueue: 3 });
  check(
    "the agent estimates once the gate is cleared",
    estimate.kind === "estimate",
    estimate.kind === "estimate"
      ? `basis=${estimate.basis} sample=${String(estimate.sampleSize)}`
      : estimate.reason,
  );

  if (estimate.kind === "estimate") {
    check(
      "the estimate is a RANGE, never a point value (R-G)",
      estimate.highMinutes > estimate.lowMinutes,
      `${String(estimate.lowMinutes)} to ${String(estimate.highMinutes)} minutes for 3 ahead`,
    );
    check(
      "the sample size clears the stated gate, and is reported",
      estimate.sampleSize >= 5,
      `sampleSize=${String(estimate.sampleSize)}, basis="${describeBasis(estimate)}"`,
    );
    check(
      "the rendered text shows a range and never a bare single figure",
      /\d+ to \d+ minutes/.test(renderEstimate(estimate)),
      `"${renderEstimate(estimate)}"`,
    );
  }

  // === the estimate responds to the queue, not to nothing =================
  console.log("\n--- the estimate is a function of the queue, not a constant ---");
  const one = await estimateWaitFor({ locationId: seededId, aheadInQueue: 1 });
  const eight = await estimateWaitFor({ locationId: seededId, aheadInQueue: 8 });
  if (one.kind === "estimate" && eight.kind === "estimate") {
    check(
      "eight people ahead estimates longer than one",
      eight.highMinutes > one.highMinutes,
      `1 ahead -> ${String(one.lowMinutes)}..${String(one.highMinutes)}m, 8 ahead -> ${String(eight.lowMinutes)}..${String(eight.highMinutes)}m`,
    );
  } else {
    check("both queue depths produced estimates", false, "one of them refused unexpectedly");
  }

  // === the narrow bucket is reachable with real seeded data ==============
  console.log("\n--- backoff against real data ---");
  const withType = await ddl.query<{ st: string | null; c: string | null; h: number }>(
    `SELECT service_type_id AS st, counter_id AS c,
            EXTRACT(HOUR FROM serving_started_at)::int AS h
       FROM entries
      WHERE location_id = $1 AND status = 'served' AND serving_started_at IS NOT NULL
      GROUP BY 1,2,3 HAVING count(*) >= 5 LIMIT 1`,
    [seededId],
  );
  const narrow = withType.rows[0];
  if (narrow !== undefined) {
    const specific = await estimateWaitFor({
      locationId: seededId,
      serviceTypeId: narrow.st,
      counterId: narrow.c,
      hourOfDay: narrow.h,
      aheadInQueue: 2,
    });
    check(
      "a service type at a counter at an hour uses the NARROWEST bucket when it clears the gate",
      specific.kind === "estimate" && specific.basis === "service_type+counter+hour",
      specific.kind === "estimate"
        ? `basis=${specific.basis} sample=${String(specific.sampleSize)}`
        : specific.reason,
    );
  } else {
    console.log("[SKIP] no narrow bucket reached 5 samples in the seeded data; backoff is covered by unit tests");
  }

  // === purity, asserted against the shipped file =========================
  console.log("\n--- the agent is pure, and that is checked not promised ---");
  const { readFile } = await import("node:fs/promises");
  const agentSource = await readFile("src/agents/wait-time.ts", "utf8");
  const code = agentSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    "the agent imports nothing at all",
    !/^\s*import\s/m.test(code),
    "no imports in src/agents/wait-time.ts. P1 and X1 are asserted by the boundary checker; this is the same fact read directly.",
  );
  check(
    "the agent contains no SQL and no connection",
    !/SELECT |INSERT |pg\.|Pool|connectionString/.test(code),
    "it takes a snapshot and returns a proposal. The orchestrator does the I/O.",
  );

  // === teardown ==========================================================
  await ddl.query("DELETE FROM events WHERE location_id = $1", [freshId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [freshId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [freshId]);
  await ddl.end();
  await closeWritePool();

  console.log(failures === 0 ? "\nC3 PROVEN." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

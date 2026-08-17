// C5 proof, Build Order 3 section 3.
//
// PREMISE CORRECTION, stated first because it changes what this proof means.
// C5 says the Adherence Agent "already measures whether staff serve off the
// queue" and describes an extension. IT DID NOT EXIST: a grep for "adherence"
// across src/, scripts/, tests/ and db/ returned nothing before this work.
// So this proves an agent that was BUILT, not extended.
//
// The fixture FORCES every branch, including the defect path. An unapproved
// out-of-order call should be impossible under I7, so a proof that never
// produces one has not tested the only finding this agent can raise.

import pg from "pg";

import { startServer } from "../src/api/server.ts";
import { PROVISIONAL_BELOW } from "../src/agents/adherence.ts";
import type { AdherenceReport } from "../src/agents/adherence.ts";
import { closeReadPool } from "../src/persistence/read/index.ts";

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

const PORT = 3161;

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-c5-proof",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('C5 Adherence Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  const mk = async (label: string): Promise<string> => {
    const r = await ddl.query<{ id: string }>(
      "INSERT INTO counters (location_id, label) VALUES ($1, $2) RETURNING id",
      [locationId, label],
    );
    return String(r.rows[0]?.id);
  };
  // Counter Z is spotless, Counter A is not. If anything ever sorts by
  // adherence, Z would lead and the label order would break.
  const counterA = await mk("Counter A");
  const counterZ = await mk("Counter Z");

  const logCall = async (
    counterId: string,
    kind: "call_next" | "out_of_order_call",
    approver: string | null,
  ): Promise<void> => {
    const e = await ddl.query<{ id: string }>(
      `INSERT INTO entries (location_id, status, channel, is_synthetic, counter_id)
       VALUES ($1,'called','reception',true,$2) RETURNING id`,
      [locationId, counterId],
    );
    await ddl.query(
      `INSERT INTO events (location_id, entry_id, kind, from_status, to_status, actor, approver)
       VALUES ($1,$2,$3,'waiting','called','fixture',$4)`,
      [locationId, e.rows[0]?.id, kind, approver],
    );
  };

  // Counter A: 8 ordinary, 1 approved override, 1 UNAPPROVED override.
  for (let i = 0; i < 8; i += 1) await logCall(counterA, "call_next", null);
  await logCall(counterA, "out_of_order_call", "Maria");
  await logCall(counterA, "out_of_order_call", null);
  // Counter Z: 4 ordinary only. Below the provisional threshold on purpose.
  for (let i = 0; i < 4; i += 1) await logCall(counterZ, "call_next", null);

  const server = startServer(PORT);
  await new Promise((r) => setTimeout(r, 400));

  try {
    const res = await fetch(
      `http://localhost:${String(PORT)}/api/adherence?locationId=${encodeURIComponent(locationId)}`,
    );
    const body = (await res.json()) as { ok: boolean; value: AdherenceReport };
    check("adherence is served as JSON, read-only", res.status === 200 && body.ok, `HTTP ${String(res.status)}`);
    const report = body.value;

    // === drift per counter, which is what C5 asks for ===================
    console.log("\n--- drift per counter ---");
    const a = report.perCounter.find((c) => c.label === "Counter A");
    check(
      "adherence is reported PER COUNTER, with in-order and out-of-order separated",
      a?.totalCalls === 10 && a?.inOrder === 8,
      `Counter A: ${String(a?.totalCalls)} calls, ${String(a?.inOrder)} in order, ${String(a?.outOfOrderApproved)} approved override, ${String(a?.outOfOrderUnapproved)} unapproved`,
    );
    check(
      "the rate carries its denominator (R-F)",
      a?.adherence.numerator === 8 && a?.adherence.denominator === 10,
      `${String(a?.adherence.numerator)}/${String(a?.adherence.denominator)} = ${String(a?.adherence.rate)}`,
    );

    // === the DEFECT path, which is the only finding this agent raises ===
    console.log("\n--- an unapproved override is a DEFECT, not a statistic ---");
    check(
      "the unapproved out-of-order call is COUNTED",
      a?.outOfOrderUnapproved === 1,
      `unapproved=${String(a?.outOfOrderUnapproved)}`,
    );
    check(
      "and it is RAISED AS A FINDING, separately from the figures",
      report.findings.length === 1 && /DEFECT/.test(String(report.findings[0])),
      `"${String(report.findings[0])}"`,
    );
    check(
      "the finding names the invariant it violates, so it is actionable",
      /I7/.test(String(report.findings[0])),
      "I7: an out-of-order call carries a named approver. If one does not, the gate failed.",
    );
    check(
      "an APPROVED override raises no finding, because judgment with a name on it is not a fault",
      report.findings.length === 1,
      `1 finding for 1 unapproved call, and none for the approved one`,
    );

    // === R-F ============================================================
    console.log("\n--- R-F ---");
    const labels = report.perCounter.map((c) => c.label);
    check(
      "counters are listed by LABEL even though sorting by adherence would reorder them",
      JSON.stringify(labels) === JSON.stringify([...labels].sort()),
      `order: ${labels.join(", ")}. Counter Z has perfect adherence and is still listed second.`,
    );
    const z = report.perCounter.find((c) => c.label === "Counter Z");
    check(
      "the provisional flag FIRES on the thin counter and not on the thick one",
      z?.adherence.provisional === true && a?.adherence.provisional === false,
      `Counter Z n=${String(z?.adherence.denominator)} provisional, Counter A n=${String(a?.adherence.denominator)} not. Threshold ${String(PROVISIONAL_BELOW)}.`,
    );
    const payload = JSON.stringify(report);
    check(
      "no employee is named and nothing is ranked",
      !/"(staff|employee|teller|rank|score|best|worst)"\s*:/i.test(payload),
      "measurement is by counter; there is no staff table to join to",
    );
    check(
      "the REPORTS-DOES-NOT-ACT posture travels in the payload",
      report.notes.some((n) => /REPORTS and does not act/i.test(n)),
      "so a surface cannot render this as a recommendation",
    );
    check(
      "the payload proposes no action, no routing and no recommendation",
      !/"(recommendation|action|route|reassign|suggest)"\s*:/i.test(payload),
      "figures and findings only. A human reads them and decides.",
    );

    // === it writes nothing ==============================================
    const before = await ddl.query<{ n: string }>("SELECT count(*)::text AS n FROM events");
    await fetch(`http://localhost:${String(PORT)}/api/adherence?locationId=${encodeURIComponent(locationId)}`);
    const after = await ddl.query<{ n: string }>("SELECT count(*)::text AS n FROM events");
    check(
      "reading adherence writes nothing",
      before.rows[0]?.n === after.rows[0]?.n,
      `events ${String(before.rows[0]?.n)} -> ${String(after.rows[0]?.n)}`,
    );
  } finally {
    server.close();
    await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM counters WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
    await ddl.end();
    await closeReadPool();
  }

  console.log(failures === 0 ? "\nC5 PROVEN." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

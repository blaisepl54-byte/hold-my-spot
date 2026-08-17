// B1 connection and limits proof. Build Order 2 rev 2, section B1.
//
// PROPERTY ONE, connection. Each of the three roles connects from this repo and
// reports its own current_user. Three connections, three distinct users.
//
// PROPERTY TWO, limits. Each role is proven bounded by attempting an operation
// it must not hold and OBSERVING REJECTION. A grant that cannot be verified
// without superuser is reported UNVERIFIABLE, never as passing.
//
// Role model source: HMS-KS-002 v4 R5, ruled PRIMARY for this by BUILD_ORDER_2
// section B1. v2 contains no role model. v4 is UNSEALED and read as reference.
//
// INSTRUMENT CHOICE, stated per section 5. The read and write halves go through
// the REAL pool modules, src/persistence/read and src/persistence/write, not
// through a fresh client built here. That is deliberate and it is the whole
// point of W15: proving hms_ro cannot write does not prove the read path
// CONNECTS as hms_ro. Asserting current_user on the actual pool the application
// uses is the only form of this proof that means anything. hms_ddl has no pool
// module, being used solely by db/migrate.ts, so it gets a direct client that
// reads the same env var migrate.ts reads.

import pg from "pg";

import { assertConnectedRole, refuseSuperuser } from "./assert-role.ts";
import { readPool, closeReadPool } from "../src/persistence/read/index.ts";
import { writePool, closeWritePool } from "../src/persistence/write/index.ts";

type Outcome = "PASS" | "FAIL" | "UNVERIFIABLE";

type Check = {
  readonly property: string;
  readonly detail: string;
  readonly outcome: Outcome;
  readonly evidence: string;
};

const checks: Check[] = [];

function record(
  property: string,
  detail: string,
  outcome: Outcome,
  evidence: string,
): void {
  checks.push({ property, detail, outcome, evidence });
  console.log(`[${outcome.padEnd(12)}] ${property}: ${detail}`);
  console.log(`               evidence: ${evidence}`);
}

// A rejection is only proof if it is the RIGHT rejection. 42501 is
// insufficient_privilege. A syntax error or a missing relation would also throw
// and would prove nothing about grants, so the code is checked, not just the
// fact that something failed.
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

async function expectRejection(
  property: string,
  detail: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
    record(
      property,
      detail,
      "FAIL",
      "the operation SUCCEEDED. The role is not bounded as claimed.",
    );
  } catch (error) {
    const code = pgCode(error);
    if (code === INSUFFICIENT_PRIVILEGE) {
      record(property, detail, "PASS", `rejected with SQLSTATE ${code}: ${message(error)}`);
    } else {
      record(
        property,
        detail,
        "UNVERIFIABLE",
        `threw, but with SQLSTATE ${code ?? "none"}, not ${INSUFFICIENT_PRIVILEGE}. ` +
          `A non-privilege error does not prove the grant. Message: ${message(error)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  console.log("B1 connection and limits proof\n");

  // P0, Build Order 4. THE PRECONDITION, asserted BEFORE anything else.
  //
  // This proof's entire value is that things are REFUSED. A superuser is
  // refused nothing, so run as one it would report zero rejections and zero
  // failures: a clean pass proving the opposite of its claim. Until Phase 5
  // that was prevented by never holding a superuser credential, which is tier
  // V. Railway CLI access ended that, so the guarantee is now a check that
  // ABORTS, which is tier C.
  console.log("--- precondition: which role is each pool actually connected as? ---");
  for (const [pool, expected] of [
    [readPool(), "hms_ro"],
    [writePool(), "hms_rw"],
  ] as const) {
    await refuseSuperuser(pool);
    const seen = await assertConnectedRole(pool, expected);
    console.log(`[PASS        ] connected as ${seen.observed} on ${seen.database}, as required`);
  }
  console.log("");

  // ---- PROPERTY ONE ----------------------------------------------------
  console.log("--- property one, connection ---");

  const roRole = await readPool().query<{ role: string; db: string }>(
    "SELECT current_user AS role, current_database() AS db",
  );
  const roObserved = roRole.rows[0]?.role ?? "none";
  const roDb = roRole.rows[0]?.db ?? "none";
  record(
    "property one",
    "read pool connects as hms_ro",
    roObserved === "hms_ro" ? "PASS" : "FAIL",
    `src/persistence/read reported current_user=${roObserved}, database=${roDb}`,
  );

  const rwRole = await writePool().query<{ role: string; db: string }>(
    "SELECT current_user AS role, current_database() AS db",
  );
  const rwObserved = rwRole.rows[0]?.role ?? "none";
  record(
    "property one",
    "write pool connects as hms_rw",
    rwObserved === "hms_rw" ? "PASS" : "FAIL",
    `src/persistence/write reported current_user=${rwObserved}, database=${rwRole.rows[0]?.db ?? "none"}`,
  );

  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-b1-proof",
  });
  await ddl.connect();
  const ddlRole = await ddl.query<{ role: string }>("SELECT current_user AS role");
  const ddlObserved = ddlRole.rows[0]?.role ?? "none";
  record(
    "property one",
    "migration path connects as hms_ddl",
    ddlObserved === "hms_ddl" ? "PASS" : "FAIL",
    `HMS_DDL_URL reported current_user=${ddlObserved}`,
  );

  const distinct = new Set([roObserved, rwObserved, ddlObserved]);
  record(
    "property one",
    "three connections, three DISTINCT users",
    distinct.size === 3 ? "PASS" : "FAIL",
    `observed ${distinct.size} distinct: ${[...distinct].sort().join(", ")}`,
  );

  // A real query whose value must be COMPUTED by the server, so a stubbed or
  // silently-failing connection cannot coincidentally agree.
  const computed = await readPool().query<{ answer: number }>(
    "SELECT (17 * 3 + 1)::int AS answer",
  );
  const answer = computed.rows[0]?.answer;
  record(
    "property one",
    "a real query returns a server-computed value",
    answer === 52 ? "PASS" : "FAIL",
    `SELECT (17*3+1) returned ${String(answer)}, expected 52`,
  );

  // ---- PROPERTY TWO ----------------------------------------------------
  console.log("\n--- property two, limits ---");

  // hms_ro holds SELECT only (v4 R5). It must not write, and must not create.
  await expectRejection(
    "property two",
    "hms_ro is refused INSERT on schema_migrations",
    () =>
      readPool().query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ('b1_probe', 'x')",
      ),
  );

  await expectRejection(
    "property two",
    "hms_ro is refused CREATE TABLE",
    () => readPool().query("CREATE TABLE b1_probe_ro (id int)"),
  );

  // hms_rw holds DML but NO DDL (v4 R5, W17: without the third role hms_rw
  // silently carries DROP).
  await expectRejection(
    "property two",
    "hms_rw is refused CREATE TABLE, so 'No DDL' is structural",
    () => writePool().query("CREATE TABLE b1_probe_rw (id int)"),
  );

  await expectRejection(
    "property two",
    "hms_rw is refused DROP of the migration ledger",
    () => writePool().query("DROP TABLE schema_migrations"),
  );

  // hms_ddl holds DDL, but [CC] added NOSUPERUSER NOCREATEROLE NOCREATEDB so
  // that "holds DDL" does not mean "holds everything". That addition is not in
  // v4 R5 and is flagged as [CC] in db/roles.sql; this is its proof.
  try {
    await ddl.query("CREATE ROLE b1_probe_role");
    record(
      "property two",
      "hms_ddl is refused CREATE ROLE",
      "FAIL",
      "CREATE ROLE SUCCEEDED. NOCREATEROLE is not in effect.",
    );
    await ddl.query("DROP ROLE b1_probe_role");
  } catch (error) {
    const code = pgCode(error);
    record(
      "property two",
      "hms_ddl is refused CREATE ROLE",
      code === INSUFFICIENT_PRIVILEGE ? "PASS" : "UNVERIFIABLE",
      `SQLSTATE ${code ?? "none"}: ${message(error)}`,
    );
  }

  // hms_rw's read access is a GRANT, so prove the positive too. A role that is
  // bounded but also cannot do its job is not a passing result.
  const rwRead = await writePool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM schema_migrations",
  );
  record(
    "property two",
    "hms_rw CAN read schema_migrations, so it is bounded, not broken",
    rwRead.rows[0]?.n !== undefined ? "PASS" : "FAIL",
    `SELECT count(*) returned ${rwRead.rows[0]?.n ?? "nothing"}`,
  );

  await ddl.end();
  await closeReadPool();
  await closeWritePool();

  // ---- SUMMARY ---------------------------------------------------------
  console.log("\n--- summary ---");
  const pass = checks.filter((c) => c.outcome === "PASS").length;
  const fail = checks.filter((c) => c.outcome === "FAIL").length;
  const unver = checks.filter((c) => c.outcome === "UNVERIFIABLE").length;
  console.log(`PASS ${pass}   FAIL ${fail}   UNVERIFIABLE ${unver}`);

  if (unver > 0) {
    console.log("\nUNVERIFIABLE checks, reported rather than passed:");
    for (const c of checks.filter((x) => x.outcome === "UNVERIFIABLE")) {
      console.log(`  - ${c.detail}: ${c.evidence}`);
    }
  }

  if (fail > 0) {
    console.log("\nFAILED checks:");
    for (const c of checks.filter((x) => x.outcome === "FAIL")) {
      console.log(`  - ${c.detail}: ${c.evidence}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

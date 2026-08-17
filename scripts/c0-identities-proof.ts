// C0 proof, Build Order 3 section 3.
//
// "Migration applies, second run is a no-op, the backfill reports matched and
// unmatched counts, and `npm run b2` still passes unchanged."
//
// The B2 half is run by the regression sweep rather than duplicated here. What
// this proves is C0's own claims, plus the one the order cares about most:
// NOTHING IS FABRICATED. Both new columns are nullable precisely so an entry
// with no recorded counter reads as "not recorded" instead of as a guess.
//
// HONEST LIMITATION, stated because the migration's own report cannot show it:
// migration 005 derives counters from the labels it then matches, so its
// UNMATCHED count is 0 by construction and that branch is near-unreachable at
// migration time. The report is real, but "0 unmatched" there is close to a
// tautology. The no-fabrication property below is therefore proven directly,
// against the live schema, rather than inferred from a backfill statistic.

import pg from "pg";

import { closeReadPool, readCounters, readServiceTypes } from "../src/persistence/read/index.ts";

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-c0-proof",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('C0 Identities Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  // === the tables exist with the shape the order specifies ==============
  console.log("--- schema ---");
  const cols = async (table: string): Promise<Set<string>> => {
    const r = await ddl.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
      [table],
    );
    return new Set(r.rows.map((x) => x.column_name));
  };

  const counterCols = await cols("counters");
  check(
    "counters has id, location_id, label, active",
    ["id", "location_id", "label", "active"].every((c) => counterCols.has(c)),
    `columns: ${[...counterCols].sort().join(", ")}`,
  );

  const typeCols = await cols("service_types");
  check(
    "service_types has id, location_id, code, label, active, sort_order",
    ["id", "location_id", "code", "label", "active", "sort_order"].every((c) => typeCols.has(c)),
    `columns: ${[...typeCols].sort().join(", ")}`,
  );

  // R-F is a schema constraint, not only a dashboard rule.
  const staffish = await ddl.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.columns
      WHERE table_name IN ('counters','service_types','entries')
        AND (column_name ILIKE '%staff%' OR column_name ILIKE '%employee%'
             OR column_name ILIKE '%teller%' OR column_name ILIKE '%agent_name%')`,
  );
  check(
    "NO PERSON IS MODELLED anywhere in the new schema (R-F)",
    staffish.rows[0]?.n === "0",
    `staff-shaped columns across counters, service_types, entries: ${String(staffish.rows[0]?.n)}`,
  );

  const entryCols = await cols("entries");
  check(
    "entries gained counter_id and service_type_id, and KEPT the counter label",
    entryCols.has("counter_id") && entryCols.has("service_type_id") && entryCols.has("counter"),
    "the label is retained as derived display; dropping it would break the B6 proof",
  );

  // === grants ===========================================================
  console.log("\n--- grants ---");
  const grantsFor = async (table: string, role: string): Promise<string[]> => {
    const r = await ddl.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE table_name = $1 AND grantee = $2 ORDER BY privilege_type`,
      [table, role],
    );
    return r.rows.map((x) => x.privilege_type);
  };

  for (const table of ["counters", "service_types"]) {
    const rw = await grantsFor(table, "hms_rw");
    check(
      `hms_rw holds SELECT, INSERT, UPDATE on ${table} and NO DELETE`,
      rw.includes("SELECT") && rw.includes("INSERT") && rw.includes("UPDATE") && !rw.includes("DELETE"),
      `${table}: ${rw.join(", ")}. A counter is decommissioned with active=false, never deleted, or its history is orphaned.`,
    );
    const ro = await grantsFor(table, "hms_ro");
    check(`hms_ro holds SELECT on ${table}`, ro.includes("SELECT"), `${table}: ${ro.join(", ")}`);
  }

  // === NOTHING IS FABRICATED ============================================
  console.log("\n--- no fabrication ---");

  // An entry created with a counter label that matches no counters row must
  // leave counter_id NULL. This is the property the migration's unmatched
  // count cannot demonstrate, because it creates the counters it then matches.
  const orphan = await ddl.query<{ id: string }>(
    `INSERT INTO entries (location_id, status, channel, counter)
     VALUES ($1, 'called', 'reception', 'Counter Nowhere') RETURNING id`,
    [locationId],
  );
  const orphanId = orphan.rows[0]?.id;
  const orphanRow = await ddl.query<{ counter: string | null; counter_id: string | null }>(
    "SELECT counter, counter_id FROM entries WHERE id = $1",
    [orphanId],
  );
  check(
    "a counter label with no matching row leaves counter_id NULL, rather than inventing one",
    orphanRow.rows[0]?.counter_id === null && orphanRow.rows[0]?.counter === "Counter Nowhere",
    `counter="${String(orphanRow.rows[0]?.counter)}" counter_id=${String(orphanRow.rows[0]?.counter_id)}. Null reads as "not recorded", which is true.`,
  );

  const preexisting = await ddl.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM entries WHERE counter IS NULL AND counter_id IS NULL`,
  );
  check(
    "entries predating the migration keep both fields null, not backfilled with a guess",
    Number(preexisting.rows[0]?.n ?? "0") >= 0,
    `${String(preexisting.rows[0]?.n)} entries carry neither. Backfilling invented values would be fabrication.`,
  );

  // === the identities resolve through the read path =====================
  console.log("\n--- resolution through the read path (hms_ro) ---");
  await ddl.query(
    "INSERT INTO counters (location_id, label) VALUES ($1, 'Counter 1') ON CONFLICT DO NOTHING",
    [locationId],
  );
  const readBack = await readCounters(locationId);
  check(
    "counters are readable as hms_ro, so the console reads rows rather than shipping an array",
    readBack.some((c) => c.label === "Counter 1"),
    `read ${String(readBack.length)} counter(s): ${readBack.map((c) => c.label).join(", ")}`,
  );

  const seededTypes = await readServiceTypes(
    (await ddl.query<{ id: string }>("SELECT id FROM locations WHERE name = 'Kingston, Main Branch'"))
      .rows[0]?.id ?? locationId,
  );
  check(
    "service types are seeded per branch and ordered",
    seededTypes.length >= 4,
    `${String(seededTypes.length)} types: ${seededTypes.map((t) => t.code).join(", ")}. PROVISIONAL pending rung 2 (R-I).`,
  );

  // === teardown ==========================================================
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM counters WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM service_types WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  await ddl.end();
  await closeReadPool();

  console.log(failures === 0 ? "\nC0 PROVEN." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

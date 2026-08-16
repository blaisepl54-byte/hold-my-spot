// Seeds a demo branch. Idempotent: re-running does not create duplicates.
//
// Runs as hms_ddl because `locations` is branch CONFIGURATION and hms_rw has no
// write path to it, per migration 002. Configuring a branch is a deliberate act,
// not something the queue does to itself.
//
// R11: no customer data is seeded here. Entries are created by using the
// console, and every one of them carries is_synthetic.

import pg from "pg";

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

  await ddl.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

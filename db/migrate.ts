// Migration runner, v4 T1.6 and R7. Plain SQL files, no ORM.
//
// Connects as hms_ddl (v4 R5), the only role holding DDL. hms_rw deliberately
// does not, so a compromised or careless write path cannot DROP (W17).
//
// Applies files in db/migrations/ in lexical order, records each in
// schema_migrations with a checksum, and refuses to re-apply a version whose
// checksum has changed since it was applied.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

async function ensureLedger(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      checksum    text        NOT NULL
    )
  `);
}

export async function migrate(): Promise<void> {
  const client = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-migrate",
  });
  await client.connect();

  try {
    const role = await client.query<{ role: string }>("SELECT current_user AS role");
    console.log(`connected as: ${role.rows[0]?.role ?? "unknown"}`);

    await ensureLedger(client);

    const applied = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const seen = new Map(applied.rows.map((r) => [r.version, r.checksum]));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const sum = checksum(sql);
      const previous = seen.get(file);

      if (previous !== undefined) {
        if (previous !== sum) {
          throw new Error(
            `${file} was applied with checksum ${previous} but now hashes to ${sum}. ` +
              `Migrations are forward-only; edit is not permitted after apply.`,
          );
        }
        console.log(`skip  ${file} (already applied)`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [file, sum],
        );
        await client.query("COMMIT");
        console.log(`apply ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

// Run only when this file is the entry point. The earlier form tested
// `import.meta.url.endsWith("migrate.ts")`, which is a tautology for this
// module, so the guard reduced to "argv[1] exists" and ANY import of this file
// would have run the migrations. Compare against the resolved entry URL instead.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  migrate().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

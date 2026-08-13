// LIVE MODULE, v4 section 1 exception 3. Carries the read-write pool.
// Connects as hms_rw (v4 R5): SELECT, INSERT, UPDATE, DELETE, and NO DDL.
// Once the entries table exists, UPDATE(joined_at) is revoked from this role,
// which is what makes I1 tier S rather than convention (W9).
//
// P3: this module is directly imported only by src/orchestrator/apply/.
// It has a home here rather than being improvised inside api/, which was W3(a).
//
// The pool is created lazily. Importing this module must not open a socket.

import pg from "pg";

let pool: pg.Pool | undefined;

export function writePool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: process.env["HMS_RW_URL"],
    max: 8,
    application_name: "hms-write",
  });
  return pool;
}

export async function closeWritePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

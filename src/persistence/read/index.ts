// LIVE MODULE, v4 section 1 exception 2. Carries the read-only pool and a
// liveness query. Connects as hms_ro (v4 R5), which holds SELECT only, so this
// path is structurally incapable of writing rather than merely discouraged.
//
// The pool is created lazily. Importing this module must not open a socket, so
// that the boundary checker and the type-stripping proof can load it freely.

import pg from "pg";

let pool: pg.Pool | undefined;

export function readPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: process.env["HMS_RO_URL"],
    max: 4,
    application_name: "hms-read",
  });
  return pool;
}

export type Liveness = {
  readonly ok: boolean;
  readonly role: string | null;
  readonly reason: string | null;
};

// Asserts the wiring, not just the grant (v4 R5, closing W15): a passing
// liveness check reports which role the pool actually connected as, so
// "hms_ro cannot write" and "the read path IS hms_ro" are separate claims and
// both are observable.
export async function checkLiveness(): Promise<Liveness> {
  try {
    const result = await readPool().query<{ role: string }>(
      "SELECT current_user AS role",
    );
    const role = result.rows[0]?.role ?? null;
    return { ok: role !== null, role, reason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, role: null, reason };
  }
}

export async function closeReadPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

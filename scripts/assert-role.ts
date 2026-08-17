// The connected-role precondition. P0, Build Order 4.
//
// ===========================================================================
// WHY THIS EXISTS, and it is a TIER CHANGE rather than a cosmetic edit
// ===========================================================================
// Until now, proof integrity rested on ABSENCE: Claude Code never held a
// superuser credential, so a proof could not accidentally connect as one. That
// is tier V. It held because nothing enforced it.
//
// Railway CLI access ends that. `railway connect` opens a superuser session and
// the tunnel prints a superuser URL. The old protection is gone, so it is
// REPLACED rather than pretended, per Build Order 4 section 0.
//
// What replaces it is stronger: every proof asserts which role it is connected
// as BEFORE it asserts anything else, and ABORTS if the answer is wrong. A
// proof accidentally connected as superuser now FAILS LOUDLY instead of passing
// silently. That is a mechanism that rejects, which is tier C.
//
// The distinction matters most for a REJECTION proof. A superuser is refused
// nothing, so every "permission denied" check would simply not fire, and a
// suite of rejection tests connected as superuser produces zero rejections and
// zero failures. It would report a clean run while proving the exact opposite
// of its claim. That is the "passes while proving something else" pattern
// Build Order 3 named as its dominant risk, and a remote proof is MORE
// susceptible to it, not less.

export type RoleAssertion = {
  readonly expected: string;
  readonly observed: string;
  readonly database: string;
};

type Queryable = {
  query: (sql: string) => Promise<{ rows: { role?: unknown; db?: unknown }[] }>;
};

export class WrongRoleError extends Error {}

// Throws rather than returning a result. A precondition that can be ignored by
// a caller who forgets to check its return value is not a precondition.
export async function assertConnectedRole(
  client: Queryable,
  expected: string,
): Promise<RoleAssertion> {
  const result = await client.query("SELECT current_user AS role, current_database() AS db");
  const row = result.rows[0];
  const observed = typeof row?.role === "string" ? row.role : "unknown";
  const database = typeof row?.db === "string" ? row.db : "unknown";

  if (observed !== expected) {
    throw new WrongRoleError(
      `CONNECTED AS THE WRONG ROLE. Expected "${expected}", got "${observed}" on database ` +
        `"${database}". Refusing to run: a rejection proof connected as the wrong role, and ` +
        `especially as a superuser, would report a clean pass while proving nothing. ` +
        `Check which URL this proof was given.`,
    );
  }

  return { expected, observed, database };
}

// Superusers are refused nothing, so this is the specific case that would turn
// a rejection suite into a silent no-op. Named separately so the failure message
// says what actually went wrong.
export async function refuseSuperuser(client: Queryable): Promise<void> {
  const result = await client.query(
    "SELECT current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text AS db",
  );
  const row = result.rows[0];
  if (String(row?.db) === "true") {
    throw new WrongRoleError(
      `CONNECTED AS A SUPERUSER ("${String(row?.role)}"). Refusing to run. A superuser is ` +
        `refused nothing, so every rejection check would pass by not firing.`,
    );
  }
}

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

// B6. The console's read model.
//
// This goes through the READ pool deliberately. The console is the busiest
// reader in the system and it has no business holding a connection that could
// write; routing it here means a console bug cannot corrupt a queue, and it is
// hms_ro's grant that makes that structural rather than a promise.
export type QueueRow = {
  readonly id: string;
  readonly status: string;
  readonly channel: string;
  readonly joined_at: Date;
  readonly confirmed_at: Date | null;
  readonly undeliverable_at: Date | null;
  readonly prompt_delivered_at: Date | null;
  readonly left_reason: string | null;
  readonly counter: string | null;
  readonly contact: string | null;
};

export async function readQueue(locationId: string): Promise<readonly QueueRow[]> {
  const result = await readPool().query<QueueRow>(
    `SELECT id, status, channel, joined_at, confirmed_at, undeliverable_at,
            prompt_delivered_at, left_reason, counter, contact
       FROM entries
      WHERE location_id = $1
        AND status IN ('provisional', 'waiting', 'called', 'serving')
      ORDER BY joined_at`,
    [locationId],
  );
  return result.rows;
}

export type DayTotals = {
  readonly served: number;
  readonly noshow: number;
  readonly left: number;
};

export async function readDayTotals(locationId: string): Promise<DayTotals> {
  const result = await readPool().query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n
       FROM entries
      WHERE location_id = $1 AND status IN ('served', 'noshow', 'left')
      GROUP BY status`,
    [locationId],
  );
  const by = new Map(result.rows.map((r) => [r.status, Number(r.n)]));
  return {
    served: by.get("served") ?? 0,
    noshow: by.get("noshow") ?? 0,
    left: by.get("left") ?? 0,
  };
}

export type LocationRow = {
  readonly id: string;
  readonly name: string;
  readonly close_of_day_policy: string;
  readonly timezone: string;
};

export async function readLocations(): Promise<readonly LocationRow[]> {
  const result = await readPool().query<LocationRow>(
    "SELECT id, name, close_of_day_policy, timezone FROM locations ORDER BY name",
  );
  return result.rows;
}

// The fairness log, newest first. The console shows it because an audit trail
// nobody can see is an audit trail nobody checks.
export type EventRow = {
  readonly id: string;
  readonly kind: string;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly actor: string | null;
  readonly reason: string | null;
  readonly approver: string | null;
  readonly occurred_at: Date;
};

export async function readEvents(
  locationId: string,
  limit = 30,
): Promise<readonly EventRow[]> {
  const result = await readPool().query<EventRow>(
    `SELECT id, kind, from_status, to_status, actor, reason, approver, occurred_at
       FROM events WHERE location_id = $1 ORDER BY id DESC LIMIT $2`,
    [locationId, limit],
  );
  return result.rows;
}

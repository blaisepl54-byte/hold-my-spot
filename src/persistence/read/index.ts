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
  readonly name: string | null;
};

export async function readQueue(locationId: string): Promise<readonly QueueRow[]> {
  const result = await readPool().query<QueueRow>(
    `SELECT id, status, channel, joined_at, confirmed_at, undeliverable_at,
            prompt_delivered_at, left_reason, counter, contact, name
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

// C0. Counters and service types, read as hms_ro.
export type CounterRow = {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
};

export async function readCounters(locationId: string): Promise<readonly CounterRow[]> {
  const result = await readPool().query<CounterRow>(
    "SELECT id, label, active FROM counters WHERE location_id = $1 AND active ORDER BY label",
    [locationId],
  );
  return result.rows;
}

export type ServiceTypeRow = {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly sort_order: number;
};

// PROVISIONAL LIST, per R-I. The caller is expected to say so wherever these
// are displayed; the data does not carry its own disclaimer, so the surfaces do.
export async function readServiceTypes(locationId: string): Promise<readonly ServiceTypeRow[]> {
  const result = await readPool().query<ServiceTypeRow>(
    `SELECT id, code, label, sort_order FROM service_types
      WHERE location_id = $1 AND active ORDER BY sort_order, label`,
    [locationId],
  );
  return result.rows;
}

// C2. Is there an unanswered survey for this entry? Read as hms_ro.
export async function readSurveyStatus(
  entryId: string,
): Promise<{ readonly exists: boolean; readonly open: boolean }> {
  const result = await readPool().query<{ responded_at: Date | null }>(
    "SELECT responded_at FROM surveys WHERE entry_id = $1",
    [entryId],
  );
  const row = result.rows[0];
  return { exists: row !== undefined, open: row !== undefined && row.responded_at === null };
}

// C3. Completed service history, the agent's input. Read as hms_ro.
//
// Only entries that were actually SERVED with a closed window count. An entry
// that left, no-showed, or is still being served has no duration, and including
// it would drag every median toward a number nobody observed.
export type ServiceHistoryRow = {
  readonly service_type_id: string | null;
  readonly counter_id: string | null;
  readonly hour_of_day: number;
  readonly duration_minutes: number;
};

export async function readServiceHistory(
  locationId: string,
  limit = 2000,
): Promise<readonly ServiceHistoryRow[]> {
  const result = await readPool().query<ServiceHistoryRow>(
    `SELECT service_type_id,
            counter_id,
            EXTRACT(HOUR FROM serving_started_at)::int AS hour_of_day,
            (EXTRACT(EPOCH FROM (serving_ended_at - serving_started_at)) / 60.0)::float8
              AS duration_minutes
       FROM entries
      WHERE location_id = $1
        AND status = 'served'
        AND serving_started_at IS NOT NULL
        AND serving_ended_at IS NOT NULL
      ORDER BY serving_ended_at DESC
      LIMIT $2`,
    [locationId, limit],
  );
  return result.rows;
}

// P1. The entry a contact currently holds, so an inbound WhatsApp message can
// find the place in line it belongs to.
//
// NEWEST FIRST, and scoped to one location. A customer served yesterday who
// messages again today must reach today's entry; ordering by joined_at
// descending is the only rule that gets that right without a session concept.
//
// Read as hms_ro, so looking a customer up is structurally incapable of
// changing anything about them.
export type ContactEntry = {
  readonly id: string;
  readonly status: string;
  readonly name: string | null;
};

export async function readEntryByContact(
  locationId: string,
  contact: string,
): Promise<ContactEntry | undefined> {
  const result = await readPool().query<ContactEntry>(
    `SELECT id, status, name
       FROM entries
      WHERE location_id = $1
        AND contact = $2
      ORDER BY joined_at DESC
      LIMIT 1`,
    [locationId, contact],
  );
  return result.rows[0];
}

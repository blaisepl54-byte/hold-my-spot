// P2/FE-001. The admin's cross-branch read. hms_ro, like every other read.
//
// One query per concern, grouped in SQL, so adding a fiftieth branch changes
// the row count and not the query count. R-F: keyed on branch, no employee
// appears anywhere in this shape.

import { readPool } from "./index.ts";

export type BranchOverview = {
  readonly locationId: string;
  readonly name: string;
  readonly timezone: string;
  readonly waiting: number;
  readonly provisional: number;
  readonly called: number;
  readonly serving: number;
  readonly servedToday: number;
  readonly noshowToday: number;
  readonly leftToday: number;
};

export async function readAdminOverview(): Promise<readonly BranchOverview[]> {
  const result = await readPool().query<{
    location_id: string;
    name: string;
    timezone: string;
    waiting: string;
    provisional: string;
    called: string;
    serving: string;
    served_today: string;
    noshow_today: string;
    left_today: string;
  }>(
    `SELECT l.id AS location_id,
            l.name,
            l.timezone,
            count(*) FILTER (WHERE e.status = 'waiting')     AS waiting,
            count(*) FILTER (WHERE e.status = 'provisional') AS provisional,
            count(*) FILTER (WHERE e.status = 'called')      AS called,
            count(*) FILTER (WHERE e.status = 'serving')     AS serving,
            count(*) FILTER (WHERE e.status = 'served'
              AND e.joined_at >= date_trunc('day', now() AT TIME ZONE l.timezone) AT TIME ZONE l.timezone) AS served_today,
            count(*) FILTER (WHERE e.status = 'noshow'
              AND e.joined_at >= date_trunc('day', now() AT TIME ZONE l.timezone) AT TIME ZONE l.timezone) AS noshow_today,
            count(*) FILTER (WHERE e.status = 'left'
              AND e.joined_at >= date_trunc('day', now() AT TIME ZONE l.timezone) AT TIME ZONE l.timezone) AS left_today
       FROM locations l
       LEFT JOIN entries e ON e.location_id = l.id
      GROUP BY l.id, l.name, l.timezone
      ORDER BY l.name`,
  );
  return result.rows.map((r) => ({
    locationId: r.location_id,
    name: r.name,
    timezone: r.timezone,
    waiting: Number(r.waiting),
    provisional: Number(r.provisional),
    called: Number(r.called),
    serving: Number(r.serving),
    servedToday: Number(r.served_today),
    noshowToday: Number(r.noshow_today),
    leftToday: Number(r.left_today),
  }));
}

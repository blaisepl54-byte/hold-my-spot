// The branch dashboard's read model. C4, Build Order 3.
//
// READ ONLY, as hms_ro. It writes nothing, and it cannot: the read pool holds
// SELECT only, proven by B1's rejection. That is not a promise about this file,
// it is a property of the connection it uses.
//
// ===========================================================================
// R-F IS ENFORCED HERE, IN THE DATA, NOT ONLY IN THE VIEW
// ===========================================================================
// The constraints from R-F are requirements rather than preferences, and a
// constraint enforced only by a template is one the next template forgets.
//
//   NO RANKING. Every list this module returns is ordered by LABEL or by CODE.
//   Nothing is ever ordered by a performance figure, and no "best" or "worst"
//   is computed. A caller that wanted a leaderboard would have to build it
//   itself, and would be visibly doing so.
//
//   EVERY RATE CARRIES ITS DENOMINATOR. Rates are never returned as a bare
//   number. Each is a { rate, numerator, denominator } so a renderer cannot
//   display one without the sample it rests on. "A rate without its denominator
//   is a rumour."
//
//   BELOW TEN IS PROVISIONAL. Carried as a flag on the figure itself rather
//   than computed by the view, so every surface agrees on what is provisional.
//
//   NO PERSON. There is no staff table to join to, by construction in C0.
//   Nothing here can name an employee because nothing in the schema stores one.

import { readPool } from "./index.ts";
import { reportAdherence } from "../../agents/adherence.ts";
import type { AdherenceReport, CallObservation } from "../../agents/adherence.ts";

// Below this a figure is shown as provisional. R-F names ten.
export const PROVISIONAL_BELOW = 10;

export type Rate = {
  readonly rate: number | null;
  readonly numerator: number;
  readonly denominator: number;
  readonly provisional: boolean;
};

function rate(numerator: number, denominator: number): Rate {
  return {
    // Null rather than zero when there is nothing to divide by. A zero rate
    // reads as "they never solve anything"; null reads as "we do not know",
    // which is the truth.
    rate: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
    provisional: denominator < PROVISIONAL_BELOW,
  };
}

export type DurationStats = {
  readonly count: number;
  readonly medianMinutes: number | null;
  readonly q1Minutes: number | null;
  readonly q3Minutes: number | null;
  readonly provisional: boolean;
};

export type CounterPanel = {
  readonly counterId: string;
  readonly label: string;
  readonly services: DurationStats;
  readonly byServiceType: readonly {
    readonly code: string;
    readonly label: string;
    readonly stats: DurationStats;
  }[];
  readonly solveRate: Rate;
  readonly surveysSent: number;
  readonly waitMatch: {
    readonly shorter: number;
    readonly asExpected: number;
    readonly longer: number;
    readonly responses: number;
  };
};

export type ServiceTypePanel = {
  readonly code: string;
  readonly label: string;
  readonly stats: DurationStats;
  readonly counterMix: readonly {
    readonly label: string;
    readonly count: number;
    readonly share: number;
  }[];
  readonly solveRate: Rate;
};

export type Calibration = {
  readonly predicted: number;
  readonly within: number;
  readonly under: number;
  readonly over: number;
  readonly accuracy: Rate;
};

export type Dashboard = {
  readonly windowDays: number;
  readonly counters: readonly CounterPanel[];
  readonly serviceTypes: readonly ServiceTypePanel[];
  readonly calibration: Calibration;
  readonly notes: readonly string[];
};

type StatRow = {
  count: string;
  median: string | null;
  q1: string | null;
  q3: string | null;
};

function toStats(row: StatRow | undefined): DurationStats {
  const count = Number(row?.count ?? "0");
  return {
    count,
    medianMinutes: row?.median === null || row?.median === undefined ? null : Number(row.median),
    q1Minutes: row?.q1 === null || row?.q1 === undefined ? null : Number(row.q1),
    q3Minutes: row?.q3 === null || row?.q3 === undefined ? null : Number(row.q3),
    provisional: count < PROVISIONAL_BELOW,
  };
}

const DURATION_SQL = `
  count(*)::text AS count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY mins)::text AS median,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY mins)::text AS q1,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY mins)::text AS q3`;

export async function readDashboard(
  locationId: string,
  windowDays = 30,
): Promise<Dashboard> {
  const pool = readPool();

  // Ordered by LABEL. Not by volume, not by duration, not by solve rate.
  const counters = await pool.query<{ id: string; label: string }>(
    "SELECT id, label FROM counters WHERE location_id = $1 AND active ORDER BY label",
    [locationId],
  );

  const counterPanels: CounterPanel[] = [];
  for (const counter of counters.rows) {
    const stats = await pool.query<StatRow>(
      `WITH served AS (
         SELECT EXTRACT(EPOCH FROM (serving_ended_at - serving_started_at))/60.0 AS mins
           FROM entries
          WHERE location_id = $1 AND counter_id = $2 AND status = 'served'
            AND serving_ended_at IS NOT NULL
            AND serving_ended_at > now() - make_interval(days => $3::int)
       ) SELECT ${DURATION_SQL} FROM served`,
      [locationId, counter.id, windowDays],
    );

    const byType = await pool.query<StatRow & { code: string; label: string }>(
      `WITH served AS (
         SELECT st.code, st.label,
                EXTRACT(EPOCH FROM (e.serving_ended_at - e.serving_started_at))/60.0 AS mins
           FROM entries e JOIN service_types st ON st.id = e.service_type_id
          WHERE e.location_id = $1 AND e.counter_id = $2 AND e.status = 'served'
            AND e.serving_ended_at IS NOT NULL
            AND e.serving_ended_at > now() - make_interval(days => $3::int)
       )
       SELECT code, label, ${DURATION_SQL} FROM served GROUP BY code, label ORDER BY code`,
      [locationId, counter.id, windowDays],
    );

    const survey = await pool.query<{
      sent: string; responses: string; yes: string;
      shorter: string; as_expected: string; longer: string;
    }>(
      `SELECT count(*)::text AS sent,
              count(s.responded_at)::text AS responses,
              count(*) FILTER (WHERE s.achieved)::text AS yes,
              count(*) FILTER (WHERE s.wait_match = 'shorter')::text AS shorter,
              count(*) FILTER (WHERE s.wait_match = 'as_expected')::text AS as_expected,
              count(*) FILTER (WHERE s.wait_match = 'longer')::text AS longer
         FROM surveys s JOIN entries e ON e.id = s.entry_id
        WHERE e.location_id = $1 AND e.counter_id = $2
          AND s.sent_at > now() - make_interval(days => $3::int)`,
      [locationId, counter.id, windowDays],
    );
    const sv = survey.rows[0];

    counterPanels.push({
      counterId: counter.id,
      label: counter.label,
      services: toStats(stats.rows[0]),
      byServiceType: byType.rows.map((r) => ({
        code: r.code,
        label: r.label,
        stats: toStats(r),
      })),
      // Solve rate's denominator is RESPONSES, not sent. Dividing by sent would
      // count silence as dissatisfaction.
      solveRate: rate(Number(sv?.yes ?? "0"), Number(sv?.responses ?? "0")),
      surveysSent: Number(sv?.sent ?? "0"),
      waitMatch: {
        shorter: Number(sv?.shorter ?? "0"),
        asExpected: Number(sv?.as_expected ?? "0"),
        longer: Number(sv?.longer ?? "0"),
        responses: Number(sv?.responses ?? "0"),
      },
    });
  }

  // Ordered by CODE. Again, never by a performance figure.
  const types = await pool.query<{ id: string; code: string; label: string }>(
    "SELECT id, code, label FROM service_types WHERE location_id = $1 AND active ORDER BY sort_order, code",
    [locationId],
  );

  const typePanels: ServiceTypePanel[] = [];
  for (const type of types.rows) {
    const stats = await pool.query<StatRow>(
      `WITH served AS (
         SELECT EXTRACT(EPOCH FROM (serving_ended_at - serving_started_at))/60.0 AS mins
           FROM entries
          WHERE location_id = $1 AND service_type_id = $2 AND status = 'served'
            AND serving_ended_at IS NOT NULL
            AND serving_ended_at > now() - make_interval(days => $3::int)
       ) SELECT ${DURATION_SQL} FROM served`,
      [locationId, type.id, windowDays],
    );

    const mix = await pool.query<{ label: string; n: string }>(
      `SELECT c.label, count(*)::text AS n
         FROM entries e JOIN counters c ON c.id = e.counter_id
        WHERE e.location_id = $1 AND e.service_type_id = $2 AND e.status = 'served'
          AND e.serving_ended_at > now() - make_interval(days => $3::int)
        GROUP BY c.label ORDER BY c.label`,
      [locationId, type.id, windowDays],
    );
    const mixTotal = mix.rows.reduce((sum, r) => sum + Number(r.n), 0);

    const survey = await pool.query<{ responses: string; yes: string }>(
      `SELECT count(s.responded_at)::text AS responses,
              count(*) FILTER (WHERE s.achieved)::text AS yes
         FROM surveys s JOIN entries e ON e.id = s.entry_id
        WHERE e.location_id = $1 AND e.service_type_id = $2
          AND s.sent_at > now() - make_interval(days => $3::int)`,
      [locationId, type.id, windowDays],
    );

    typePanels.push({
      code: type.code,
      label: type.label,
      stats: toStats(stats.rows[0]),
      counterMix: mix.rows.map((r) => ({
        label: r.label,
        count: Number(r.n),
        share: mixTotal === 0 ? 0 : Number(r.n) / mixTotal,
      })),
      solveRate: rate(Number(survey.rows[0]?.yes ?? "0"), Number(survey.rows[0]?.responses ?? "0")),
    });
  }

  // Calibration: what we SAID against what happened. The observed wait is taken
  // from the fairness log's `called` event, not recomputed, because the log is
  // the record of when a place in line actually moved.
  const calib = await pool.query<{ predicted: string; within: string; under: string; over: string }>(
    `WITH called AS (
       SELECT e.id, e.predicted_low_minutes AS lo, e.predicted_high_minutes AS hi,
              EXTRACT(EPOCH FROM (min(ev.occurred_at) - e.joined_at))/60.0 AS actual
         FROM entries e
         JOIN events ev ON ev.entry_id = e.id AND ev.to_status = 'called'
        WHERE e.location_id = $1
          AND e.predicted_low_minutes IS NOT NULL
          AND e.joined_at > now() - make_interval(days => $2::int)
        GROUP BY e.id, e.predicted_low_minutes, e.predicted_high_minutes, e.joined_at
     )
     SELECT count(*)::text AS predicted,
            count(*) FILTER (WHERE actual BETWEEN lo AND hi)::text AS within,
            count(*) FILTER (WHERE actual < lo)::text AS under,
            count(*) FILTER (WHERE actual > hi)::text AS over
       FROM called`,
    [locationId, windowDays],
  );
  const cal = calib.rows[0];
  const predicted = Number(cal?.predicted ?? "0");

  return {
    windowDays,
    counters: counterPanels,
    serviceTypes: typePanels,
    calibration: {
      predicted,
      within: Number(cal?.within ?? "0"),
      under: Number(cal?.under ?? "0"),
      over: Number(cal?.over ?? "0"),
      accuracy: rate(Number(cal?.within ?? "0"), predicted),
    },
    // Carried WITH the data so no surface can render the dashboard and omit
    // them. R-F requires the footnote; putting it in the payload means every
    // client gets it whether or not its author read the order.
    notes: [
      "Measurement is by COUNTER. No employee is named anywhere in this system, by schema as well as by policy (R-F).",
      "Nothing here is ranked. Counters are listed by label and service types by code, never by performance.",
      `Any figure with a sample below ${String(PROVISIONAL_BELOW)} is marked provisional.`,
      "Service types are a PLACEHOLDER list pending rung 2 branch interviews (R-I).",
      "No routing decision is taken automatically from any figure on this page.",
      "Where history is synthetic, the estimates and durations above rest on generated data.",
    ],
  };
}


// C5. Adherence input, read as hms_ro and handed to the PURE agent.
//
// The observations come from the FAIRNESS LOG, not from the entries table. The
// log is the record of when a place in line actually moved and it carries the
// trigger and the approver, which is exactly what adherence is about. Entries
// carry only the current state, so a counter that took an out-of-order call and
// then completed the service normally would look identical to one that did not.
//
// Only calls are considered: `to_status = 'called'`. The trigger distinguishes
// an ordinary Call Next from an out-of-order override, and the approver column
// is carried through so an unapproved override can be raised as the defect it is.
export async function readAdherence(
  locationId: string,
  windowDays = 30,
): Promise<AdherenceReport> {
  const result = await readPool().query<{
    label: string | null;
    kind: string;
    approver: string | null;
  }>(
    `SELECT c.label, ev.kind, ev.approver
       FROM events ev
       JOIN entries e ON e.id = ev.entry_id
       LEFT JOIN counters c ON c.id = e.counter_id
      WHERE ev.location_id = $1
        AND ev.to_status = 'called'
        AND ev.occurred_at > now() - make_interval(days => $2::int)`,
    [locationId, windowDays],
  );

  const observations: CallObservation[] = result.rows.map((row) => ({
    // A call with no resolved counter is still a call and must not vanish from
    // the denominator. Dropping it would flatter every counter's adherence.
    counterLabel: row.label ?? "(unattributed)",
    outOfOrder: row.kind === "out_of_order_call",
    approver: row.approver,
  }));

  return reportAdherence(observations);
}

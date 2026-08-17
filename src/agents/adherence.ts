// The Adherence Agent. C5, Build Order 3.
//
// ===========================================================================
// PREMISE CORRECTION, recorded rather than absorbed.
//
// C5 says "The Adherence Agent ALREADY measures whether staff serve off the
// queue" and describes an EXTENSION. It did not exist. A grep for "adherence"
// across src/, scripts/, tests/ and db/ returned nothing, and src/agents/ held
// only the Phase-1 boundary marker and the wait time agent built in C3.
//
// So this is BUILT, not extended, and calling it extended would misdescribe the
// work. The order's intent is unambiguous, the data to satisfy it exists, and
// the interpretation below is stated so it can be overruled.
// ===========================================================================
//
// PURE. Same contract as the wait time agent: a snapshot in, a report out. It
// opens nothing, writes nothing, and the boundary checker's P1 and X1 hold it
// to that.
//
// REPORTS, DOES NOT ACT. This is the posture the order names and R-F extends to
// the whole measurement layer. The agent produces figures; a human reads them.
// It proposes no routing, recommends no action, and ranks nothing.

// What counts as drift, stated because the phrase "serve off the queue" needs a
// definition before it can be measured.
//
// Call Next always selects the earliest-joined waiting entry, so an ordinary
// call CANNOT be out of order. The only way to serve someone other than the
// person the queue named is the out-of-order path, which v4's I7 gates behind a
// NAMED APPROVER. Drift is therefore the out-of-order rate, and it separates
// into two very different things:
//
//   APPROVED out-of-order   a rule being applied by a human who put their name
//                           to it. Visible, attributable, and often correct.
//   UNAPPROVED out-of-order an out-of-order call with no approver recorded.
//                           I7 says this should be impossible. If the count is
//                           ever above zero it is not drift, it is a DEFECT,
//                           and the report says so in those words.
export type CallObservation = {
  readonly counterLabel: string;
  readonly outOfOrder: boolean;
  readonly approver: string | null;
};

export type AdherenceRate = {
  readonly rate: number | null;
  readonly numerator: number;
  readonly denominator: number;
  readonly provisional: boolean;
};

// R-F: below ten a figure is provisional. Same threshold as the dashboard, and
// deliberately the same constant meaning, so two surfaces cannot disagree about
// what "provisional" means.
export const PROVISIONAL_BELOW = 10;

function rateOf(numerator: number, denominator: number): AdherenceRate {
  return {
    rate: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
    provisional: denominator < PROVISIONAL_BELOW,
  };
}

export type CounterAdherence = {
  readonly label: string;
  readonly totalCalls: number;
  readonly inOrder: number;
  readonly outOfOrderApproved: number;
  readonly outOfOrderUnapproved: number;
  // The proportion of calls taken in queue order. Reported as a rate WITH its
  // denominator, never bare.
  readonly adherence: AdherenceRate;
};

export type AdherenceReport = {
  readonly perCounter: readonly CounterAdherence[];
  readonly totalUnapproved: number;
  readonly findings: readonly string[];
  readonly notes: readonly string[];
};

export function reportAdherence(
  observations: readonly CallObservation[],
): AdherenceReport {
  const byLabel = new Map<string, CallObservation[]>();
  for (const observation of observations) {
    const list = byLabel.get(observation.counterLabel) ?? [];
    list.push(observation);
    byLabel.set(observation.counterLabel, list);
  }

  // Sorted by LABEL. R-F forbids ranking, and sorting by adherence would be a
  // leaderboard whatever it was called.
  const labels = [...byLabel.keys()].sort();

  const perCounter: CounterAdherence[] = labels.map((label) => {
    const calls = byLabel.get(label) ?? [];
    const outOfOrder = calls.filter((c) => c.outOfOrder);
    const unapproved = outOfOrder.filter(
      (c) => c.approver === null || c.approver.trim() === "",
    );
    const inOrder = calls.length - outOfOrder.length;
    return {
      label,
      totalCalls: calls.length,
      inOrder,
      outOfOrderApproved: outOfOrder.length - unapproved.length,
      outOfOrderUnapproved: unapproved.length,
      adherence: rateOf(inOrder, calls.length),
    };
  });

  const totalUnapproved = perCounter.reduce((sum, c) => sum + c.outOfOrderUnapproved, 0);

  // FINDINGS are separated from figures deliberately. A rate is something to
  // look at; a finding is something that should not be true at all. Mixing them
  // would let a real defect read as one more number on a page of numbers.
  const findings: string[] = [];
  if (totalUnapproved > 0) {
    findings.push(
      `${String(totalUnapproved)} out-of-order call(s) carry NO named approver. ` +
        `Invariant I7 requires one, so this is a DEFECT rather than drift, and the ` +
        `gate that should have refused it did not.`,
    );
  }

  return {
    perCounter,
    totalUnapproved,
    findings,
    notes: [
      "Adherence is the proportion of calls taken in queue order. Call Next always selects the earliest-joined waiting entry, so an ordinary call cannot be out of order.",
      "An APPROVED out-of-order call is a human applying judgment with their name attached. It is visible and attributable, and it is often the right call. It is not a fault.",
      "This agent REPORTS and does not act. It proposes no routing and recommends no action; a human reads it and decides.",
      "Nothing here is ranked. Counters are listed by label, never by adherence.",
      `Any figure with a sample below ${String(PROVISIONAL_BELOW)} is marked provisional.`,
      "Measurement is by COUNTER. No employee is named, by schema as well as by policy (R-F).",
    ],
  };
}

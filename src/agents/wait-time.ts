// The Wait Time Agent. C3, Build Order 3.
//
// PURE. Input is a snapshot, output is a proposal. It opens nothing, decides
// nothing, and writes nothing. P1 forbids any path from here to a write path
// and X1 forbids importing any package or node builtin; the boundary checker
// asserts both, so this file's purity is checked rather than promised.
//
// R-G IS THE HARD RULE AND THIS IS THE FIRST PLACE IT CAN BE VIOLATED:
// customer-facing estimates are a RANGE, never a point value, and only after
// the sample gate passes. Where the gate fails the honest string is emitted and
// NO ESTIMATE IS INVENTED. That is why `no_estimate` is a first-class result
// here rather than a null the caller has to notice.
//
// The agent never extrapolates from a sample below the gate. A confident number
// built on two observations is worse than no number, because a customer acts on
// it and nobody can see what it rested on.

export type CompletedService = {
  readonly serviceTypeId: string | null;
  readonly counterId: string | null;
  // 0 to 23, local to the branch. Bucketed rather than continuous because a
  // branch at 9am and the same branch at 4pm are different systems.
  readonly hourOfDay: number;
  readonly durationMinutes: number;
};

export type WaitSnapshot = {
  readonly history: readonly CompletedService[];
  // How many people are ahead of this customer in line. Supplied by the caller
  // from the queue, because counting the queue is the orchestrator's job.
  readonly aheadInQueue: number;
  readonly serviceTypeId: string | null;
  readonly counterId: string | null;
  readonly hourOfDay: number;
};

// The buckets, in backoff order. Named so `basis` can say which one answered.
export type Basis =
  | "service_type+counter+hour"
  | "service_type"
  | "location"
  | "none";

export type WaitEstimate =
  | {
      readonly kind: "estimate";
      readonly lowMinutes: number;
      readonly highMinutes: number;
      readonly basis: Basis;
      readonly sampleSize: number;
    }
  | { readonly kind: "no_estimate"; readonly reason: string };

// Five completed services. Below this the bucket falls through rather than
// answering. The number is a policy choice, stated here rather than buried, and
// it is the single knob that decides how often the honest string appears.
export const MINIMUM_SAMPLE = 5;

// The honest string, defined once. A caller that invents its own wording could
// soften it, and softening it is exactly how "we do not know" becomes "about
// twenty minutes".
export const NO_ESTIMATE_TEXT =
  "We cannot estimate your wait yet, so we would rather not guess. You will be called in turn.";

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? 0;
  // Linear interpolation between the two neighbours, so a small sample does not
  // snap the range to whichever observation happens to sit at the index.
  return low + (high - low) * (position - lower);
}

function bucketFor(snapshot: WaitSnapshot, basis: Basis): readonly CompletedService[] {
  const { history } = snapshot;
  switch (basis) {
    case "service_type+counter+hour":
      if (snapshot.serviceTypeId === null || snapshot.counterId === null) return [];
      return history.filter(
        (h) =>
          h.serviceTypeId === snapshot.serviceTypeId &&
          h.counterId === snapshot.counterId &&
          h.hourOfDay === snapshot.hourOfDay,
      );
    case "service_type":
      if (snapshot.serviceTypeId === null) return [];
      return history.filter((h) => h.serviceTypeId === snapshot.serviceTypeId);
    case "location":
      // The snapshot is already scoped to one branch by the caller, so every
      // observation in it is this location's.
      return history;
    case "none":
      return [];
  }
}

const BACKOFF: readonly Basis[] = ["service_type+counter+hour", "service_type", "location"];

export function estimateWait(snapshot: WaitSnapshot): WaitEstimate {
  for (const basis of BACKOFF) {
    const bucket = bucketFor(snapshot, basis);

    // THE GATE. Below the minimum the bucket does not answer, it falls through.
    // It does not answer with lower confidence, and it does not widen its range
    // to compensate: both would be extrapolation wearing a disclaimer.
    if (bucket.length < MINIMUM_SAMPLE) continue;

    const durations = bucket.map((h) => h.durationMinutes).sort((a, b) => a - b);
    const q1 = quantile(durations, 0.25);
    const q3 = quantile(durations, 0.75);

    // INTERPRETATION, FLAGGED because the order's phrasing admits two readings.
    //
    // The order says: "the interquartile span of observed durations for the
    // bucket, plus the count of entries ahead in queue multiplied by the bucket
    // median." That could mean a median-centred point with the IQR added as
    // spread, or the span itself propagated through the queue.
    //
    // Taken as the second: low = ahead x Q1, high = ahead x Q3. The reasons are
    // that it CANNOT produce a point value even when the IQR is zero and the
    // queue is one deep, that it never yields a negative lower bound the way
    // "median minus half the span" can, and that it propagates real observed
    // spread rather than a symmetric assumption the data does not support.
    // Named here so a reviewer can overrule the reading rather than have to
    // reverse-engineer it.
    const ahead = Math.max(0, snapshot.aheadInQueue);

    // Rounded outward: low down, high up. An estimate should never understate
    // its own top end, because that is the number a customer plans around.
    const lowMinutes = Math.max(0, Math.floor(ahead * q1));
    const highMinutes = Math.max(1, Math.ceil(ahead * q3));

    return {
      kind: "estimate",
      lowMinutes,
      // A degenerate bucket, where every observed duration is identical, would
      // otherwise produce low === high, which is a point value by arithmetic
      // even though the code never intended one. R-G forbids that, so the
      // range is widened by a minute rather than the rule being bent.
      highMinutes: highMinutes > lowMinutes ? highMinutes : lowMinutes + 1,
      basis,
      sampleSize: bucket.length,
    };
  }

  return {
    kind: "no_estimate",
    reason: `no bucket reached the minimum sample of ${String(MINIMUM_SAMPLE)} completed services`,
  };
}

// Customer-facing rendering, per R-G. Kept beside the agent so the range and
// the words describing it cannot drift apart, and so no caller has to decide
// how to phrase a refusal.
export function renderEstimate(estimate: WaitEstimate): string {
  if (estimate.kind === "no_estimate") return NO_ESTIMATE_TEXT;
  return `Estimated wait ${String(estimate.lowMinutes)} to ${String(estimate.highMinutes)} minutes.`;
}

// `basis` and `sampleSize` travel with every estimate so the console and the
// dashboard can show what the number rests on. An estimate whose provenance is
// invisible is a number people trust more than they should.
export function describeBasis(estimate: WaitEstimate): string {
  if (estimate.kind === "no_estimate") return "no estimate";
  const label: Record<Basis, string> = {
    "service_type+counter+hour": "this service at this counter at this hour",
    service_type: "this service across the branch",
    location: "all services at this branch",
    none: "nothing",
  };
  return `${label[estimate.basis]}, ${String(estimate.sampleSize)} completed services`;
}

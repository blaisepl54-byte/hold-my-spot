// Synthetic service history. C3, Build Order 3.
//
// PURE VALUES ONLY. This module generates data; it does not write it. The seed
// script does the writing, through the ordinary path, so no new write path is
// created. R11 governs the result: everything produced here is synthetic and
// the entries it becomes carry `is_synthetic = true`.
//
// DETERMINISTIC BY CONSTRUCTION. There is no Math.random anywhere in this file.
// A seeded generator means the same seed produces the same history, so a demo
// is reproducible, a test can assert exact values, and a surprising estimate
// can be traced back to the data that produced it. Randomness would make every
// downstream number unreproducible and every failure a one-off.
//
// WHY THIS EXISTS AT ALL, stated plainly because it is the uncomfortable part:
// without history the wait time agent correctly returns `no_estimate` for every
// request on day one. That is CORRECT BEHAVIOUR and a poor demo. Seeding makes
// the demo show the feature; it does not make the feature true of a real branch.
// The order requires the demo to say so out loud, and the seed script prints it.

export type SyntheticService = {
  readonly serviceTypeCode: string;
  readonly counterLabel: string;
  readonly hourOfDay: number;
  readonly durationMinutes: number;
};

// A small linear congruential generator. Chosen over anything cleverer because
// the properties that matter here are "deterministic" and "readable", not
// statistical quality: this is demo history, not a simulation anyone reasons
// from. Numerical Recipes constants.
function nextSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function unit(seed: number): number {
  return seed / 4294967296;
}

// Service types differ in how long they take, and that difference is the whole
// point of bucketing by service type. A branch where every visit takes the same
// time would make C4's "median duration by service type" a flat line.
export type ServiceProfile = {
  readonly code: string;
  // Minutes. The spread is what the interquartile range will recover, so it
  // must be real rather than noise around a single value.
  readonly typicalMinutes: number;
  readonly spreadMinutes: number;
};

export const DEMO_PROFILES: readonly ServiceProfile[] = [
  { code: "deposit_withdrawal", typicalMinutes: 4, spreadMinutes: 2 },
  { code: "general_enquiry", typicalMinutes: 6, spreadMinutes: 3 },
  { code: "card_services", typicalMinutes: 11, spreadMinutes: 5 },
  { code: "account_services", typicalMinutes: 17, spreadMinutes: 8 },
];

export type GenerateOptions = {
  readonly seed: number;
  readonly count: number;
  readonly counters: readonly string[];
  readonly profiles?: readonly ServiceProfile[];
  // Branch hours. Outside these the branch is shut, so generating history there
  // would put observations in buckets that can never be queried.
  readonly openHour?: number;
  readonly closeHour?: number;
};

export function generateHistory(options: GenerateOptions): readonly SyntheticService[] {
  const profiles = options.profiles ?? DEMO_PROFILES;
  const openHour = options.openHour ?? 9;
  const closeHour = options.closeHour ?? 16;
  const out: SyntheticService[] = [];

  let seed = options.seed >>> 0;
  const roll = (): number => {
    seed = nextSeed(seed);
    return unit(seed);
  };

  for (let i = 0; i < options.count; i += 1) {
    const profile = profiles[Math.floor(roll() * profiles.length)] ?? profiles[0];
    if (profile === undefined) break;
    const counter = options.counters[Math.floor(roll() * options.counters.length)];
    if (counter === undefined) break;

    const hourOfDay = openHour + Math.floor(roll() * (closeHour - openHour + 1));

    // Triangular-ish: two rolls averaged, so durations cluster around the
    // typical value with genuine tails rather than sitting uniformly across the
    // spread. A uniform distribution would give an interquartile range that
    // says nothing about where most services actually land.
    const wobble = (roll() + roll()) / 2 - 0.5;
    const duration = profile.typicalMinutes + wobble * 2 * profile.spreadMinutes;

    out.push({
      serviceTypeCode: profile.code,
      counterLabel: counter,
      hourOfDay,
      // At least one minute. A zero-minute service is not a service, and it
      // would drag a median toward a number no branch has ever observed.
      durationMinutes: Math.max(1, Math.round(duration)),
    });
  }

  return out;
}

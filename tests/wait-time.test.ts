// Wait time agent tests. PURE, no database.
//
// The properties under test are R-G's: a RANGE never a point, and NO ESTIMATE
// where the sample gate fails. Both are rules about what the agent must refuse
// to do, so most of these tests assert a refusal.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MINIMUM_SAMPLE,
  NO_ESTIMATE_TEXT,
  describeBasis,
  estimateWait,
  renderEstimate,
} from "../src/agents/wait-time.ts";
import type { CompletedService, WaitSnapshot } from "../src/agents/wait-time.ts";
import { DEMO_PROFILES, generateHistory } from "../src/synthetic/index.ts";

function service(
  overrides: Partial<CompletedService> & { durationMinutes: number },
): CompletedService {
  return {
    serviceTypeId: overrides.serviceTypeId ?? "svc-a",
    counterId: overrides.counterId ?? "ctr-1",
    hourOfDay: overrides.hourOfDay ?? 10,
    durationMinutes: overrides.durationMinutes,
  };
}

function snapshot(overrides: Partial<WaitSnapshot> = {}): WaitSnapshot {
  // `?? default` would treat an EXPLICIT null as absent and substitute the
  // default, which is exactly the case the null-service-type test is trying to
  // construct. The first version of this helper did that and the test failed
  // against a snapshot it had never actually built. The agent was right; the
  // fixture was lying to it.
  return {
    history: overrides.history ?? [],
    aheadInQueue: overrides.aheadInQueue ?? 3,
    serviceTypeId: "serviceTypeId" in overrides ? overrides.serviceTypeId ?? null : "svc-a",
    counterId: "counterId" in overrides ? overrides.counterId ?? null : "ctr-1",
    hourOfDay: overrides.hourOfDay ?? 10,
  };
}

const many = (n: number, minutes: number[]): CompletedService[] =>
  Array.from({ length: n }, (_, i) => service({ durationMinutes: minutes[i % minutes.length] ?? 5 }));

// --- R-G: the gate ---------------------------------------------------------

test("with NO history the agent refuses, and does not invent a number", () => {
  const result = estimateWait(snapshot());
  assert.equal(result.kind, "no_estimate");
});

test("BELOW the sample gate the agent refuses, however tempting the data looks", () => {
  // Four tightly-clustered observations. A mean would look very confident here,
  // and that confidence is exactly what the gate exists to refuse.
  const history = many(MINIMUM_SAMPLE - 1, [10, 10, 11, 10]);
  const result = estimateWait(snapshot({ history }));
  assert.equal(result.kind, "no_estimate");
  if (result.kind !== "no_estimate") return;
  assert.match(result.reason, /minimum sample/);
});

test("AT the gate exactly, the agent answers", () => {
  const history = many(MINIMUM_SAMPLE, [8, 10, 12, 9, 11]);
  const result = estimateWait(snapshot({ history }));
  assert.equal(result.kind, "estimate");
});

test("the agent NEVER returns a point value, even when every observation is identical", () => {
  // A degenerate bucket: zero interquartile spread. Arithmetic would give
  // low === high, which is a point value even though nothing intended one.
  const history = many(10, [10]);
  const result = estimateWait(snapshot({ history, aheadInQueue: 2 }));
  assert.equal(result.kind, "estimate");
  if (result.kind !== "estimate") return;
  assert.ok(
    result.highMinutes > result.lowMinutes,
    `range must be a range: got ${String(result.lowMinutes)}..${String(result.highMinutes)}`,
  );
});

test("the honest string is emitted where the gate fails, and it does not hedge into a number", () => {
  const text = renderEstimate(estimateWait(snapshot()));
  assert.equal(text, NO_ESTIMATE_TEXT);
  assert.equal(/\d/.test(text), false, "the refusal must contain no digits to be misread as an estimate");
});

// --- the backoff -----------------------------------------------------------

test("backoff falls through to the branch-wide bucket when the narrow ones are thin", () => {
  // Two at this counter and hour, plus eight elsewhere in the branch. The
  // narrow bucket is under the gate; the widest is not.
  const history: CompletedService[] = [
    ...many(2, [10]),
    ...Array.from({ length: 8 }, () =>
      service({ durationMinutes: 20, counterId: "ctr-9", hourOfDay: 15, serviceTypeId: "svc-z" }),
    ),
  ];
  const result = estimateWait(snapshot({ history }));
  assert.equal(result.kind, "estimate");
  if (result.kind !== "estimate") return;
  assert.equal(result.basis, "location", "it must widen, not answer from two observations");
  assert.equal(result.sampleSize, 10);
});

test("the NARROWEST bucket wins when it clears the gate", () => {
  const history: CompletedService[] = [
    ...many(6, [4, 5, 6, 4, 5, 6]),
    ...Array.from({ length: 40 }, () =>
      service({ durationMinutes: 60, counterId: "ctr-9", serviceTypeId: "svc-z" }),
    ),
  ];
  const result = estimateWait(snapshot({ history }));
  assert.equal(result.kind, "estimate");
  if (result.kind !== "estimate") return;
  assert.equal(result.basis, "service_type+counter+hour");
  assert.equal(result.sampleSize, 6, "the specific bucket, not the 46-row pile");
});

test("an unknown service type cannot use the narrow buckets", () => {
  const history = many(20, [5, 6, 7]);
  const result = estimateWait(snapshot({ history, serviceTypeId: null }));
  assert.equal(result.kind, "estimate");
  if (result.kind !== "estimate") return;
  assert.equal(result.basis, "location", "with no service type, only the branch-wide bucket applies");
});

// --- provenance ------------------------------------------------------------

test("every estimate carries its basis and sample size", () => {
  const result = estimateWait(snapshot({ history: many(12, [5, 10, 15]) }));
  assert.equal(result.kind, "estimate");
  if (result.kind !== "estimate") return;
  assert.ok(result.sampleSize > 0);
  assert.match(describeBasis(result), /completed services/);
});

test("a longer queue produces a longer wait, monotonically", () => {
  const history = many(10, [5, 10, 15, 20]);
  const one = estimateWait(snapshot({ history, aheadInQueue: 1 }));
  const five = estimateWait(snapshot({ history, aheadInQueue: 5 }));
  assert.equal(one.kind, "estimate");
  assert.equal(five.kind, "estimate");
  if (one.kind !== "estimate" || five.kind !== "estimate") return;
  assert.ok(
    five.highMinutes > one.highMinutes,
    "five people ahead cannot estimate shorter than one",
  );
});

test("nobody ahead yields a low bound of zero rather than a negative number", () => {
  const result = estimateWait(snapshot({ history: many(10, [5, 10]), aheadInQueue: 0 }));
  assert.equal(result.kind, "estimate");
  if (result.kind !== "estimate") return;
  assert.equal(result.lowMinutes, 0);
  assert.ok(result.highMinutes >= 1);
});

// --- the synthetic generator ----------------------------------------------

test("synthetic history is DETERMINISTIC: the same seed gives the same history", () => {
  const options = { seed: 42, count: 50, counters: ["Counter 1", "Counter 2"] };
  const a = generateHistory(options);
  const b = generateHistory(options);
  assert.deepEqual(a, b, "a reproducible demo requires a reproducible generator");
});

test("a different seed gives different history", () => {
  const counters = ["Counter 1"];
  const a = generateHistory({ seed: 1, count: 40, counters });
  const b = generateHistory({ seed: 2, count: 40, counters });
  assert.notDeepEqual(a, b);
});

test("synthetic durations are always at least one minute", () => {
  const history = generateHistory({ seed: 7, count: 400, counters: ["Counter 1", "Counter 2"] });
  assert.ok(history.every((h) => h.durationMinutes >= 1), "a zero-minute service is not a service");
});

test("synthetic history stays inside branch hours", () => {
  const history = generateHistory({
    seed: 9, count: 300, counters: ["Counter 1"], openHour: 9, closeHour: 16,
  });
  assert.ok(history.every((h) => h.hourOfDay >= 9 && h.hourOfDay <= 16));
});

test("service types differ in duration, which is what makes bucketing worth doing", () => {
  const history = generateHistory({ seed: 3, count: 800, counters: ["Counter 1"] });
  const medianFor = (code: string): number => {
    const d = history.filter((h) => h.serviceTypeCode === code)
      .map((h) => h.durationMinutes).sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)] ?? 0;
  };
  const quick = medianFor("deposit_withdrawal");
  const slow = medianFor("account_services");
  assert.ok(
    slow > quick,
    `account services (${String(slow)}m) must take longer than a deposit (${String(quick)}m), or the buckets say nothing`,
  );
});

test("the demo profiles are labelled and distinct", () => {
  const codes = new Set(DEMO_PROFILES.map((p) => p.code));
  assert.equal(codes.size, DEMO_PROFILES.length);
});

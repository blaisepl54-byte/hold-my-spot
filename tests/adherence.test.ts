// Adherence agent tests. PURE, no database.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PROVISIONAL_BELOW, reportAdherence } from "../src/agents/adherence.ts";
import type { CallObservation } from "../src/agents/adherence.ts";

function call(
  counterLabel: string,
  outOfOrder = false,
  approver: string | null = null,
): CallObservation {
  return { counterLabel, outOfOrder, approver };
}

test("a counter taking every call in order reports full adherence", () => {
  const report = reportAdherence(Array.from({ length: 12 }, () => call("Counter 1")));
  const c = report.perCounter[0];
  assert.equal(c?.adherence.rate, 1);
  assert.equal(c?.outOfOrderApproved, 0);
  assert.equal(c?.adherence.provisional, false, "12 calls is above the threshold");
});

test("an APPROVED out-of-order call is counted as drift but NOT as a fault", () => {
  const report = reportAdherence([
    ...Array.from({ length: 9 }, () => call("Counter 1")),
    call("Counter 1", true, "Maria"),
  ]);
  const c = report.perCounter[0];
  assert.equal(c?.outOfOrderApproved, 1);
  assert.equal(c?.outOfOrderUnapproved, 0);
  assert.equal(report.findings.length, 0, "an approved override is judgment, not a defect");
  assert.equal(c?.adherence.numerator, 9);
  assert.equal(c?.adherence.denominator, 10);
});

test("an UNAPPROVED out-of-order call is raised as a DEFECT, not filed as a statistic", () => {
  // I7 says this should be impossible. If it happens, the gate failed.
  const report = reportAdherence([call("Counter 1"), call("Counter 1", true, null)]);
  assert.equal(report.totalUnapproved, 1);
  assert.equal(report.findings.length, 1);
  assert.match(String(report.findings[0]), /DEFECT/);
  assert.match(String(report.findings[0]), /I7/);
});

test("whitespace is not an approver", () => {
  const report = reportAdherence([call("Counter 1", true, "   ")]);
  assert.equal(report.totalUnapproved, 1, "a blank name must not satisfy a named-approver gate");
});

test("findings are SEPARATE from figures, so a defect cannot read as one more number", () => {
  const clean = reportAdherence([call("Counter 1", true, "Andre")]);
  assert.equal(clean.findings.length, 0);
  assert.ok(clean.perCounter.length > 0, "figures are still reported");
});

// --- R-F ------------------------------------------------------------------

test("R-F: counters are listed by LABEL, never ordered by adherence", () => {
  const report = reportAdherence([
    // Counter Z is perfect, Counter A is not. A leaderboard would put Z first.
    ...Array.from({ length: 5 }, () => call("Counter Z")),
    ...Array.from({ length: 4 }, () => call("Counter A")),
    call("Counter A", true, "Maria"),
  ]);
  assert.deepEqual(
    report.perCounter.map((c) => c.label),
    ["Counter A", "Counter Z"],
    "sorted by label; sorting by adherence would be a leaderboard whatever it was called",
  );
});

test("R-F: every rate carries its denominator", () => {
  const report = reportAdherence([call("Counter 1"), call("Counter 1", true, "Maria")]);
  const c = report.perCounter[0];
  assert.equal(c?.adherence.numerator, 1);
  assert.equal(c?.adherence.denominator, 2);
});

test("R-F: a sample below the threshold is flagged provisional", () => {
  const thin = reportAdherence(Array.from({ length: PROVISIONAL_BELOW - 1 }, () => call("Counter 1")));
  const thick = reportAdherence(Array.from({ length: PROVISIONAL_BELOW }, () => call("Counter 1")));
  assert.equal(thin.perCounter[0]?.adherence.provisional, true);
  assert.equal(thick.perCounter[0]?.adherence.provisional, false);
});

test("R-F: the report states that it reports and does not act", () => {
  const report = reportAdherence([call("Counter 1")]);
  assert.ok(
    report.notes.some((n) => /REPORTS and does not act/i.test(n)),
    "the posture travels with the data, so a surface cannot render it as a recommendation",
  );
  assert.ok(report.notes.some((n) => /No employee is named/i.test(n)));
});

test("no observations yields no counters and no findings, not a zero-rate accusation", () => {
  const report = reportAdherence([]);
  assert.deepEqual(report.perCounter, []);
  assert.equal(report.findings.length, 0);
});

// Domain tests. PURE, no database, no I/O. Node's built-in runner, zero test
// dependencies (R8).
//
// These test the decisions, not the plumbing. The plumbing is proven against
// the live database by scripts/b3-*.ts, because a mocked database proves
// nothing about a grant.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSITIONS,
  checkTransition,
  carriedByCloseOfDay,
  countedForWaitMath,
  initialStatusFor,
  releasedByCloseOfDay,
  selectNextToCall,
  sendAttemptsExhausted,
  triggerForJoin,
} from "../src/domain/index.ts";
import type { QueueEntry } from "../src/domain/index.ts";

// --- the closed status set -------------------------------------------------

test("undeliverable is not a status, it is a column (ruled 2026-08-15)", () => {
  const statuses = new Set<string>();
  for (const t of TRANSITIONS) {
    if (t.from !== null) statuses.add(t.from);
    statuses.add(t.to);
  }
  assert.equal(statuses.has("undeliverable"), false);
  assert.deepEqual(
    [...statuses].sort(),
    ["called", "left", "noshow", "provisional", "served", "serving", "waiting"],
  );
});

// --- X8 channels -----------------------------------------------------------

test("whatsapp is the only channel producing a provisional entry", () => {
  assert.equal(initialStatusFor("whatsapp"), "provisional");
  assert.equal(initialStatusFor("qr"), "waiting");
  assert.equal(initialStatusFor("reception"), "waiting");
  assert.equal(triggerForJoin("whatsapp"), "remote_join");
  assert.equal(triggerForJoin("qr"), "onsite_join");
});

// --- gating ----------------------------------------------------------------

test("an out-of-order call without a named approver is refused", () => {
  const refused = checkTransition("waiting", "called", "out_of_order_call", null);
  assert.equal(refused.ok, false);

  const blank = checkTransition("waiting", "called", "out_of_order_call", "   ");
  assert.equal(blank.ok, false, "whitespace is not a name");

  const allowed = checkTransition("waiting", "called", "out_of_order_call", "Maria");
  assert.equal(allowed.ok, true);
});

test("an ordinary Call Next needs no approver, since applying a published rule is ungated", () => {
  const result = checkTransition("waiting", "called", "call_next", null);
  assert.equal(result.ok, true);
});

test("reinstating a no-show to its original position IS gated", () => {
  assert.equal(checkTransition("noshow", "waiting", "reinstate_position", null).ok, false);
  assert.equal(checkTransition("noshow", "waiting", "reinstate_position", "Andre").ok, true);
});

test("operator removal is ungated and permitted ONLY from provisional (R-A)", () => {
  assert.equal(checkTransition("provisional", "left", "operator_removal", null).ok, true);
  assert.equal(checkTransition("waiting", "left", "operator_removal", null).ok, false);
  assert.equal(checkTransition("called", "left", "operator_removal", null).ok, false);
});

test("an undefined transition is refused rather than silently allowed", () => {
  assert.equal(checkTransition("served", "waiting", "call_next", "anyone").ok, false);
});

// --- I3 and D1, the demo moment, as pure logic -----------------------------

function entry(id: string, status: QueueEntry["status"], minutesAgo: number): QueueEntry {
  return { id, status, joinedAt: new Date(Date.UTC(2026, 0, 1, 12, 0) - minutesAgo * 60_000) };
}

test("Call Next skips unconfirmed entries and reports them as a first-class result", () => {
  const result = selectNextToCall([
    entry("remote", "provisional", 30), // joined first
    entry("onsite", "waiting", 10),
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.id, "onsite");
  assert.deepEqual(
    result.steppedOver.map((e) => e.id),
    ["remote"],
    "the skipped entry is returned, not silently dropped",
  );
});

test("an unconfirmed entry HOLDS ITS PLACE: on confirming it is served before a later joiner", () => {
  // Same two entries, but the remote one has now confirmed.
  const result = selectNextToCall([
    entry("remote", "waiting", 30),
    entry("onsite", "waiting", 10),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.id, "remote", "earliest join time wins, so position was never lost");
});

test("a queue of only unconfirmed entries is not callable, and says so with the list", () => {
  const result = selectNextToCall([
    entry("a", "provisional", 30),
    entry("b", "provisional", 20),
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "empty_queue");
  assert.deepEqual(
    result.steppedOver.map((e) => e.id),
    ["a", "b"],
    "the operator must still see that two people are holding places",
  );
});

test("already-served and departed entries are not in line", () => {
  const result = selectNextToCall([
    entry("gone", "left", 60),
    entry("done", "served", 50),
    entry("live", "waiting", 5),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.id, "live");
});

test("unconfirmed entries are excluded from wait math (I3)", () => {
  const counted = countedForWaitMath([
    entry("a", "provisional", 30),
    entry("b", "waiting", 20),
    entry("c", "waiting", 10),
  ]);
  assert.deepEqual(counted.map((e) => e.id), ["b", "c"]);
});

// --- X8 transport ----------------------------------------------------------

test("send attempts are bounded, default 3, so a provisional entry always gets a clock", () => {
  assert.equal(sendAttemptsExhausted(2), false);
  assert.equal(sendAttemptsExhausted(3), true);
  assert.equal(sendAttemptsExhausted(1, 1), true);
});

// --- B4, close of day ------------------------------------------------------

test("close of day releases three statuses under reset, not four (ruling 2026-08-15)", () => {
  const queue = [
    entry("prov", "provisional", 50),
    entry("wait", "waiting", 40),
    entry("call", "called", 30),
    entry("serv", "serving", 20),
    entry("done", "served", 10),
  ];
  const released = releasedByCloseOfDay(queue, "reset").map((e) => e.id);
  assert.deepEqual(released.sort(), ["call", "prov", "wait"]);
  assert.equal(
    released.includes("serv"),
    false,
    "a serving customer is not evicted because a clock struck",
  );
});

test("roll_forward carries waiting, but still releases provisional and called", () => {
  const queue = [
    entry("prov", "provisional", 50),
    entry("wait", "waiting", 40),
    entry("call", "called", 30),
    entry("serv", "serving", 20),
  ];
  assert.deepEqual(
    releasedByCloseOfDay(queue, "roll_forward").map((e) => e.id).sort(),
    ["call", "prov"],
    "an unconfirmed entry carried overnight would take the front of tomorrow's line",
  );
  assert.deepEqual(carriedByCloseOfDay(queue, "roll_forward").map((e) => e.id), ["wait"]);
});

test("reset carries nobody", () => {
  const queue = [entry("wait", "waiting", 40)];
  assert.deepEqual(carriedByCloseOfDay(queue, "reset"), []);
});

test("close_of_day is ungated: applying a published branch policy is not a reversal", () => {
  assert.equal(checkTransition("waiting", "left", "close_of_day", null).ok, true);
  assert.equal(checkTransition("provisional", "left", "close_of_day", null).ok, true);
  assert.equal(checkTransition("called", "left", "close_of_day", null).ok, true);
});

test("close_of_day cannot touch a serving entry, enforced by the transition table itself", () => {
  assert.equal(checkTransition("serving", "left", "close_of_day", null).ok, false);
});

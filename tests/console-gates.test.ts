// The console's two render gates, pinned against the SHIPPED FILE.
//
// This reads web/console/index.html, lifts `stepGates` out of it, and runs it.
// It is deliberately not a copy of the logic: a copy would keep passing after
// somebody edited the console, which is exactly the failure it exists to stop.
//
// THE DEFECT IT PINS, observed in production 2026-09-06:
//   A serving customer was still being offered "Confirm and restore", because
//   the console decided "stepped over" from a client-side cache of one
//   call-next response. The API refused it, correctly, with
//   "No transition serving -> waiting on customer_confirms" (HTTP 409). Worse,
//   the stepped block SUPPRESSES the row's real actions, so that customer had
//   no Complete button until the page was refreshed and the cache died.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Entry = {
  status: string;
  steppedOver?: boolean;
  deferred?: boolean;
};
type Gates = { stepped: boolean; deferred: boolean };

function loadStepGates(): (e: Entry) => Gates {
  const html = readFileSync(new URL("../web/console/index.html", import.meta.url), "utf8");
  const match = /function stepGates\(e\)\{[\s\S]*?\n\}/.exec(html);
  if (match === null) {
    throw new Error("stepGates not found in web/console/index.html");
  }
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${match[0]}; return stepGates;`) as () => (e: Entry) => Gates;
  return factory();
}

const stepGates = loadStepGates();

test("a provisional entry that was passed still gets the stepped-over remedy", () => {
  const gates = stepGates({ status: "provisional", steppedOver: true });
  assert.equal(gates.stepped, true);
  assert.equal(gates.deferred, false);
});

test("THE DEFECT: a SERVING entry with a stale stepped flag gets no stepped block", () => {
  // Blaise in the 2026-09-06 report: stepped over at 09:09 while provisional,
  // confirmed over WhatsApp so the console's clear-on-verb never fired, then
  // called and served. The cache still said stepped.
  const gates = stepGates({ status: "serving", steppedOver: true });
  assert.equal(
    gates.stepped,
    false,
    "a serving entry must never render the provisional-only Confirm and restore",
  );
});

test("THE DEFECT: a called entry with a stale stepped flag gets no stepped block either", () => {
  const gates = stepGates({ status: "called", steppedOver: true });
  assert.equal(gates.stepped, false);
});

test("a deferred WAITING entry gets the deferral note and NOT the provisional remedy", () => {
  // Simone C in the same report: deferred by call_expiry, still waiting, still
  // confirmed. customer_confirms was never legal for her.
  const gates = stepGates({ status: "waiting", deferred: true, steppedOver: true });
  assert.equal(gates.stepped, false, "a confirmed customer is not an unconfirmed ghost");
  assert.equal(gates.deferred, true);
});

test("a deferred flag on an entry that has moved on renders nothing", () => {
  assert.equal(stepGates({ status: "serving", deferred: true }).deferred, false);
  assert.equal(stepGates({ status: "served", deferred: true }).deferred, false);
});

test("an ordinary waiting entry gets neither block, so it keeps its actions", () => {
  const gates = stepGates({ status: "waiting" });
  assert.equal(gates.stepped, false);
  assert.equal(gates.deferred, false);
});

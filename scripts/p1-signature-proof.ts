// P1 signature proof. Build Order 4, section P1.
//
// "Signature validation on the inbound route, so an unsigned request is
// refused."
//
// WHY THIS EXISTS WHEN tests/signature.test.ts ALREADY PASSES. Those ten tests
// pin the pure validator. They say nothing about whether the ROUTE calls it,
// calls it FIRST, or acts on what it returns. A guarantee proven on a function
// whose call site is unwatched is exactly the shape that has read as present
// and been unreachable before in this build. This drives the real express app
// over real HTTP.
//
// THE DATABASE IS DELIBERATELY POINTED AT A CLOSED PORT. That turns "the
// refusal happens before any read" from a claim about statement order into an
// OBSERVATION: a refused request returns 403 cleanly, and an accepted one
// fails loudly on the connection it was always going to make. If the check ran
// after the lookup, check 1 would come back 500 instead of 403.
//
// Positive controls are included for the same reason as B2's: a route that
// returned 403 to everything would pass a refusal-only suite while being
// broken, and would be indistinguishable from one that works.

import type { AddressInfo } from "node:net";

import { createApp } from "../src/api/index.ts";
import { computeTwilioSignature } from "../src/tools/whatsapp/signature.ts";

type Outcome = "PASS" | "FAIL" | "UNVERIFIABLE";

const results: { outcome: Outcome; label: string; evidence: string }[] = [];

function record(outcome: Outcome, label: string, evidence: string): void {
  results.push({ outcome, label, evidence });
  console.log(`[${outcome.padEnd(12)}] ${label}`);
  console.log(`               ${evidence}`);
}

const TOKEN = "p1_proof_token_not_a_real_credential";
const BASE = "https://p1-proof.invalid";
const PARAMS: Record<string, string> = {
  From: "whatsapp:+18765550123",
  To: "whatsapp:+14155238886",
  Body: "join",
  MessageSid: "SM0000000000000000000000000000p1",
};

async function post(
  origin: string,
  params: Record<string, string>,
  signature: string | undefined,
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (signature !== undefined) headers["X-Twilio-Signature"] = signature;

  const response = await fetch(`${origin}/api/twilio/inbound`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });
  return { status: response.status, body: await response.text() };
}

async function main(): Promise<void> {
  console.log("P1 signature proof, the inbound webhook route\n");

  // The environment the route reads. PUBLIC_BASE_URL is what the signature is
  // computed against, and it is CONFIGURED rather than taken from the request,
  // which is the whole reason a proxied deployment can validate at all.
  process.env["PUBLIC_BASE_URL"] = BASE;
  process.env["TWILIO_AUTH_TOKEN"] = TOKEN;
  process.env["HMS_DEFAULT_LOCATION_ID"] = "00000000-0000-0000-0000-0000000000p1".replace(
    "p1",
    "01",
  );
  // A closed port, so any database touch fails instantly and visibly.
  process.env["HMS_RO_URL"] = "postgres://unused:unused@127.0.0.1:1/hms";
  process.env["HMS_RW_URL"] = "postgres://unused:unused@127.0.0.1:1/hms";
  // The simulated transport, explicitly. This proof must never reach a phone.
  delete process.env["HMS_TRANSPORT"];

  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${String(port)}`;
  console.log(`app listening on ${origin}`);
  console.log(`signatures computed against ${BASE}/api/twilio/inbound\n`);

  const valid = computeTwilioSignature(TOKEN, `${BASE}/api/twilio/inbound`, PARAMS);

  // ---- the property the order names -----------------------------------
  console.log("--- the refusal ---");

  const unsigned = await post(origin, PARAMS, undefined);
  if (unsigned.status === 403) {
    record(
      "PASS",
      "an UNSIGNED request is refused by the ROUTE, not merely by the validator",
      `403 over real HTTP, with the database pointed at a closed port, so nothing was read`,
    );
  } else {
    record(
      "FAIL",
      "an unsigned request must be refused",
      `got ${String(unsigned.status)}. The route does not enforce the check.`,
    );
  }

  if (/reason|signature|token|configured/i.test(unsigned.body)) {
    record(
      "FAIL",
      "the refusal must not tell the caller WHY",
      `the body leaks the cause: ${unsigned.body.slice(0, 200)}`,
    );
  } else {
    record(
      "PASS",
      "the refusal does not tell the caller WHY it failed",
      `body is the empty TwiML response, so "no token" and "bad signature" are indistinguishable`,
    );
  }

  const forged = await post(
    origin,
    PARAMS,
    computeTwilioSignature("a_token_an_attacker_guessed", `${BASE}/api/twilio/inbound`, PARAMS),
  );
  record(
    forged.status === 403 ? "PASS" : "FAIL",
    "a request signed with the WRONG token is refused",
    `status ${String(forged.status)}`,
  );

  const tampered = await post(origin, { ...PARAMS, From: "whatsapp:+18765559999" }, valid);
  record(
    tampered.status === 403 ? "PASS" : "FAIL",
    "a SWAPPED SENDER is refused, which is the attack that steals a place in line",
    `status ${String(tampered.status)}`,
  );

  // ---- positive control: the 403 is caused by the signature -------------
  console.log("\n--- positive controls ---");

  // From is emptied so the route returns before it reads anything. What is
  // being observed is ONLY that the request got past the gate.
  const accepted = await post(origin, { ...PARAMS, From: "" }, undefined);
  const acceptedSigned = await post(
    origin,
    { ...PARAMS, From: "" },
    computeTwilioSignature(TOKEN, `${BASE}/api/twilio/inbound`, { ...PARAMS, From: "" }),
  );
  if (accepted.status === 403 && acceptedSigned.status === 200) {
    record(
      "PASS",
      "a CORRECTLY SIGNED request is accepted, so the 403 is caused by the signature",
      `same body, same route: unsigned 403, signed 200. The route is not refusing everything.`,
    );
  } else {
    record(
      "FAIL",
      "a correctly signed request must be accepted",
      `unsigned ${String(accepted.status)}, signed ${String(acceptedSigned.status)}. ` +
        `If both are 403 the refusal proves nothing; if both are 200 the gate is absent.`,
    );
  }

  // THE CHECK THAT MAKES "before any read" MEAN SOMETHING. A signed request
  // with a real sender reaches the entry lookup, and the database is a closed
  // port, so it MUST fail. If this returned 200 the route would not be reading
  // anything at all and the ordering claim above would be vacuous.
  const reachesDb = await post(origin, PARAMS, valid);
  if (reachesDb.status >= 500) {
    record(
      "PASS",
      "an ACCEPTED request reaches the database, so the refusals stopped short of it",
      `status ${String(reachesDb.status)} from the closed port at 127.0.0.1:1. ` +
        `The 403 paths returned cleanly from the same configuration.`,
    );
  } else {
    record(
      "UNVERIFIABLE",
      "an accepted request was expected to reach the unreachable database",
      `status ${String(reachesDb.status)}. Without this, "the check runs before any read" ` +
        `is not demonstrated, only asserted.`,
    );
  }

  // ---- break-restore ---------------------------------------------------
  // Required by King B's break-first discipline: a fix is not fixed until the
  // break has been re-applied and RED observed. The break here is the realistic
  // one, a rotated token, which makes a previously accepted request stop being
  // accepted.
  console.log("\n--- break-restore on the signature gate ---");

  process.env["TWILIO_AUTH_TOKEN"] = "the_token_was_rotated";
  const afterBreak = await post(
    origin,
    { ...PARAMS, From: "" },
    computeTwilioSignature(TOKEN, `${BASE}/api/twilio/inbound`, { ...PARAMS, From: "" }),
  );
  const brokeRed = afterBreak.status === 403;
  record(
    brokeRed ? "PASS" : "FAIL",
    "BREAK: with the token rotated, the SAME request that was accepted is now refused",
    brokeRed
      ? "RED observed. The 200 above was earned by the signature, not by the route being permissive."
      : `got ${String(afterBreak.status)}. The gate does not depend on the token, so it checks nothing.`,
  );

  // The other break that matters: the variable going missing in production.
  delete process.env["TWILIO_AUTH_TOKEN"];
  const unconfigured = await post(
    origin,
    { ...PARAMS, From: "" },
    computeTwilioSignature(TOKEN, `${BASE}/api/twilio/inbound`, { ...PARAMS, From: "" }),
  );
  record(
    unconfigured.status === 403 ? "PASS" : "FAIL",
    "BREAK: with NO token configured the route refuses, rather than becoming a no-op",
    `status ${String(unconfigured.status)}. A missing variable must fail closed.`,
  );

  process.env["TWILIO_AUTH_TOKEN"] = TOKEN;
  const restored = await post(
    origin,
    { ...PARAMS, From: "" },
    computeTwilioSignature(TOKEN, `${BASE}/api/twilio/inbound`, { ...PARAMS, From: "" }),
  );
  const backToGreen = restored.status === 200;
  record(
    backToGreen ? "PASS" : "FAIL",
    "RESTORE: with the token back, the request is accepted again",
    `status ${String(restored.status)}`,
  );

  if (brokeRed && backToGreen) {
    record(
      "PASS",
      "break-restore complete: RED then GREEN, both observed on the live route",
      "The gate was demonstrated capable of both outcomes, so its passing is meaningful.",
    );
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));

  // ---- summary ---------------------------------------------------------
  console.log("\n--- summary ---");
  const pass = results.filter((r) => r.outcome === "PASS").length;
  const fail = results.filter((r) => r.outcome === "FAIL").length;
  const unver = results.filter((r) => r.outcome === "UNVERIFIABLE").length;
  console.log(`PASS ${String(pass)}   FAIL ${String(fail)}   UNVERIFIABLE ${String(unver)}`);

  for (const r of results.filter((x) => x.outcome !== "PASS")) {
    console.log(`  ${r.outcome}: ${r.label} -- ${r.evidence}`);
  }

  if (fail > 0 || unver > 0) {
    console.log("\nP1's named property is NOT established. The inbound route must not be exposed.");
    process.exitCode = 1;
  } else {
    console.log("\nAll checks PASS. An unsigned request is refused by the route, before any read.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

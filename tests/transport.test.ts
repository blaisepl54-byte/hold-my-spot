// I11 contract tests. Tier C: a test fails if the contract is violated.
//
//   async, plain request in, {ok:true,value} or {ok:false,reason} out,
//   NEVER THROWS ACROSS THE BOUNDARY.
//
// Both implementations are driven through the SAME assertions, because "the
// simulated one behaves" proves nothing about the adapter that will actually
// carry a message. Twilio is exercised through an injected fetch, so its
// success, HTTP-failure, and thrown-exception paths are all reachable with no
// account and no network.
//
// No database. These are pure.

import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseTransport } from "../src/tools/whatsapp/index.ts";
import type { SendResult, Transport } from "../src/tools/whatsapp/index.ts";
import { SimulatedTransport } from "../src/tools/whatsapp/simulated.ts";
import { TwilioTransport, twilioConfigFromEnv } from "../src/tools/whatsapp/twilio.ts";

const REQUEST = { to: "+18765550100", body: "hello", entryId: "e1" };

function assertContractShape(result: SendResult): void {
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert.equal(typeof result.value.providerId, "string");
    assert.equal(typeof result.value.delivered, "boolean");
    assert.equal(typeof result.value.transport, "string");
  } else {
    assert.equal(typeof result.reason, "string");
    assert.ok(result.reason.length > 0, "a refusal must say why");
  }
}

// --- selection -------------------------------------------------------------

test("transport selection defaults to simulated, never to the network", () => {
  assert.equal(chooseTransport(undefined), "simulated");
  assert.equal(chooseTransport(""), "simulated");
  assert.equal(chooseTransport("Twilio"), "simulated", "a misspelling must not reach a real phone");
  assert.equal(chooseTransport("twilio"), "twilio");
});

// --- the simulated surface -------------------------------------------------

test("simulated: a send succeeds, is recorded, and is readable back", async () => {
  const t = new SimulatedTransport();
  const result = await t.send(REQUEST);
  assertContractShape(result);
  assert.equal(result.ok, true);
  assert.equal(t.inbox("e1").length, 1, "the customer's view shows the message");
  assert.equal(t.inbox("e1")[0]?.body, "hello");
});

test("simulated: scripted failure returns a reason, it does not throw", async () => {
  const t = new SimulatedTransport({ failAttempts: [1, 2] });
  const first = await t.send(REQUEST);
  const second = await t.send(REQUEST);
  const third = await t.send(REQUEST);

  assertContractShape(first);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(third.ok, true, "the third attempt succeeds, which is X8's bounded-retry case");
  assert.equal(t.attemptsFor("e1"), 3);
});

test("simulated: a send that is not delivered reports delivered:false", async () => {
  const t = new SimulatedTransport({ deliver: false });
  const result = await t.send(REQUEST);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.delivered,
    false,
    "section 3.6 is delivery-anchored, so an undelivered send must not claim delivery",
  );
});

// --- the twilio adapter ----------------------------------------------------

test("twilio: unconfigured is a REASON, not a crash", async () => {
  const t = new TwilioTransport(undefined);
  const result = await t.send(REQUEST);
  assertContractShape(result);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /twilio_not_configured/);
});

test("twilio: config is absent unless ALL three variables are present and non-empty", () => {
  assert.equal(twilioConfigFromEnv({}), undefined);
  assert.equal(
    twilioConfigFromEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }),
    undefined,
    "a partial config must not half-configure a transport",
  );
  assert.equal(
    twilioConfigFromEnv({
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      TWILIO_WHATSAPP_FROM: "",
    }),
    undefined,
    "empty string is not configuration",
  );
  const full = twilioConfigFromEnv({
    TWILIO_ACCOUNT_SID: "AC1",
    TWILIO_AUTH_TOKEN: "t",
    TWILIO_WHATSAPP_FROM: "+1",
  });
  assert.notEqual(full, undefined);
});

test("twilio: a THROWING fetch is converted to a reason, proving never-throws", async () => {
  const exploding: typeof fetch = () => {
    throw new Error("ECONNRESET, socket hang up");
  };
  const t = new TwilioTransport(
    { accountSid: "AC1", authToken: "supersecrettoken", from: "+1" },
    exploding,
  );

  // If the contract were broken this call would reject and the test would fail
  // here rather than at the assertion, which is the point.
  const result = await t.send(REQUEST);
  assertContractShape(result);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /ECONNRESET/);
});

test("twilio: an HTTP failure returns a reason and NEVER leaks the auth token", async () => {
  const token = "supersecrettoken";
  const unauthorized: typeof fetch = async () =>
    new Response("authentication failed", { status: 401 });
  const t = new TwilioTransport({ accountSid: "AC1", authToken: token, from: "+1" }, unauthorized);

  const result = await t.send(REQUEST);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /twilio_http_401/);
  assert.equal(
    result.reason.includes(token),
    false,
    "a failure message must never carry the credential that produced it",
  );
  assert.equal(
    result.reason.includes(Buffer.from(`AC1:${token}`).toString("base64")),
    false,
    "nor the encoded form of it",
  );
});

test("twilio: a queued message is NOT reported as delivered", async () => {
  const queued: typeof fetch = async () =>
    new Response(JSON.stringify({ sid: "SM123", status: "queued" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  const t = new TwilioTransport({ accountSid: "AC1", authToken: "t", from: "+1" }, queued);

  const result = await t.send(REQUEST);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.providerId, "SM123");
  assert.equal(
    result.value.delivered,
    false,
    "an acknowledgement is not a delivery; claiming otherwise would start section 3.6's clock early",
  );
});

test("twilio: a response with no sid is a refusal, not a silent success", async () => {
  const empty: typeof fetch = async () =>
    new Response(JSON.stringify({ status: "queued" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  const t = new TwilioTransport({ accountSid: "AC1", authToken: "t", from: "+1" }, empty);
  const result = await t.send(REQUEST);
  assert.equal(result.ok, false);
});

// --- both, through one gate ------------------------------------------------

test("BOTH transports satisfy I11 without either being the only path", async () => {
  const transports: Transport[] = [
    new SimulatedTransport(),
    new TwilioTransport(undefined),
    new TwilioTransport({ accountSid: "AC1", authToken: "t", from: "+1" }, () => {
      throw new Error("network gone");
    }),
  ];

  for (const t of transports) {
    const result = await t.send(REQUEST);
    assertContractShape(result);
    assert.equal(typeof t.name, "string");
  }
});

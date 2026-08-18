// Twilio signature validation tests. PURE, no network.
//
// The property under test is a REFUSAL, so most of these assert that something
// is rejected. A validation layer that has only ever been shown to accept a
// good request is indistinguishable from one that accepts everything.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeTwilioSignature,
  publicWebhookUrl,
  validateTwilioSignature,
} from "../src/tools/whatsapp/signature.ts";

const TOKEN = "test_auth_token_not_real";
const URL_ = "https://hold-my-spot-production.up.railway.app/api/twilio/inbound";
const PARAMS = {
  From: "whatsapp:+18765550123",
  To: "whatsapp:+14155238886",
  Body: "join",
  MessageSid: "SM0123456789abcdef",
};

test("a correctly signed request is accepted", () => {
  const signature = computeTwilioSignature(TOKEN, URL_, PARAMS);
  const result = validateTwilioSignature({ authToken: TOKEN, signature, url: URL_, params: PARAMS });
  assert.equal(result.ok, true);
});

test("an UNSIGNED request is refused, which is the property the order names", () => {
  const result = validateTwilioSignature({
    authToken: TOKEN, signature: undefined, url: URL_, params: PARAMS,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /missing X-Twilio-Signature/);
});

test("a request signed with the WRONG token is refused", () => {
  const forged = computeTwilioSignature("attacker_guessed_token", URL_, PARAMS);
  const result = validateTwilioSignature({
    authToken: TOKEN, signature: forged, url: URL_, params: PARAMS,
  });
  assert.equal(result.ok, false);
});

test("TAMPERING with a single parameter invalidates the signature", () => {
  // The exact attack that matters: a forged sender. Sign as one number, then
  // swap it for someone else's to steal their place in line.
  const signature = computeTwilioSignature(TOKEN, URL_, PARAMS);
  const tampered = { ...PARAMS, From: "whatsapp:+18765559999" };
  const result = validateTwilioSignature({
    authToken: TOKEN, signature, url: URL_, params: tampered,
  });
  assert.equal(result.ok, false, "a swapped sender must not validate");
});

test("tampering with the BODY invalidates the signature", () => {
  const signature = computeTwilioSignature(TOKEN, URL_, PARAMS);
  const tampered = { ...PARAMS, Body: "confirm" };
  const result = validateTwilioSignature({ authToken: TOKEN, signature, url: URL_, params: tampered });
  assert.equal(result.ok, false);
});

test("a signature valid for a DIFFERENT url is refused", () => {
  // Otherwise a signature captured from any other endpoint could be replayed here.
  const signature = computeTwilioSignature(TOKEN, "https://example.com/other", PARAMS);
  const result = validateTwilioSignature({ authToken: TOKEN, signature, url: URL_, params: PARAMS });
  assert.equal(result.ok, false);
});

test("an UNCONFIGURED token REFUSES rather than passing", () => {
  // The failure mode that matters most: a missing variable in production must
  // not turn validation into a no-op that accepts everything.
  for (const token of [undefined, ""]) {
    const result = validateTwilioSignature({
      authToken: token, signature: "anything", url: URL_, params: PARAMS,
    });
    assert.equal(result.ok, false, "no token must mean no trust");
    if (result.ok) return;
    assert.match(result.reason, /not_configured/);
  }
});

test("parameter ORDER does not change the signature, because the scheme sorts", () => {
  const a = computeTwilioSignature(TOKEN, URL_, PARAMS);
  const reordered = {
    MessageSid: PARAMS.MessageSid, Body: PARAMS.Body, To: PARAMS.To, From: PARAMS.From,
  };
  assert.equal(computeTwilioSignature(TOKEN, URL_, reordered), a);
});

test("a signature of a different LENGTH is refused without throwing", () => {
  // timingSafeEqual throws on mismatched lengths, so the guard must come first
  // or a short signature becomes a 500 instead of a clean refusal.
  const result = validateTwilioSignature({
    authToken: TOKEN, signature: "short", url: URL_, params: PARAMS,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /length mismatch/);
});

test("the webhook url is built from configuration, not inferred from the request", () => {
  assert.equal(
    publicWebhookUrl({ PUBLIC_BASE_URL: "https://hold-my-spot-production.up.railway.app" }),
    "https://hold-my-spot-production.up.railway.app/api/twilio/inbound",
  );
  assert.equal(
    publicWebhookUrl({ PUBLIC_BASE_URL: "https://x.example/" }),
    "https://x.example/api/twilio/inbound",
    "a trailing slash must not produce a double slash, which would break every signature",
  );
  assert.equal(publicWebhookUrl({}), "", "unset must be empty, so the caller refuses rather than guesses");
});

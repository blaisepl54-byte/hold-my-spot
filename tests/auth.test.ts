// P2 auth verification tests. PURE: keys are generated locally, the JWKS
// fetch is injected, no Clerk account is involved. What Clerk will do in
// production is sign tokens exactly like these with keys published exactly
// like these; the verification path under test is byte-identical.
//
// Most of these assert REFUSALS, same reasoning as the signature suite: a
// verifier shown only accepting good tokens is indistinguishable from one
// that accepts everything.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";

import {
  clearKeyCache,
  roleAtLeast,
  verifySessionToken,
} from "../src/auth/index.ts";
import type { AuthConfig, FetchJwks } from "../src/auth/index.ts";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: strangerKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const ISSUER = "https://test-instance.clerk.accounts.dev";
const PARTY = "https://hold-my-spot.netlify.app";
const CONFIG: AuthConfig = { issuer: ISSUER, authorizedParties: [PARTY] };

const jwks: FetchJwks = () =>
  Promise.resolve({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key" }] });

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(
  payload: Record<string, unknown>,
  opts: { alg?: string; kid?: string; key?: typeof privateKey } = {},
): string {
  const header = { alg: opts.alg ?? "RS256", kid: opts.kid ?? "test-key", typ: "JWT" };
  const body = `${b64url(header)}.${b64url(payload)}`;
  if (opts.alg === "none") return `${body}.`;
  const signer = createSign("RSA-SHA256");
  signer.update(body);
  return `${body}.${signer.sign(opts.key ?? privateKey).toString("base64url")}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "user_desk_1",
    iss: ISSUER,
    azp: PARTY,
    exp: now + 60,
    nbf: now - 5,
    metadata: { role: "desk" },
    ...overrides,
  };
}

beforeEach(() => {
  clearKeyCache();
});

test("a correctly signed session with a role is accepted", async () => {
  const result = await verifySessionToken(sign(claims()), CONFIG, jwks);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.session.userId, "user_desk_1");
  assert.equal(result.session.role, "desk");
});

test("ALG NONE IS REFUSED, the classic forgery", async () => {
  const result = await verifySessionToken(sign(claims(), { alg: "none" }), CONFIG, jwks);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /RS256/);
});

test("a token signed by a STRANGER'S key is refused", async () => {
  const forged = sign(claims({ metadata: { role: "admin" } }), { key: strangerKey });
  const result = await verifySessionToken(forged, CONFIG, jwks);
  assert.equal(result.ok, false, "an attacker with their own keypair must not mint admin");
});

test("TAMPERING with the role claim invalidates the signature", async () => {
  // The attack the role gate exists for: take a real desk token, swap the
  // payload for one claiming manager, keep the signature.
  const genuine = sign(claims());
  const [h, , sig] = genuine.split(".") as [string, string, string];
  const tampered = `${h}.${b64url(claims({ metadata: { role: "manager" } }))}.${sig}`;
  const result = await verifySessionToken(tampered, CONFIG, jwks);
  assert.equal(result.ok, false);
});

test("an EXPIRED token is refused", async () => {
  const now = Math.floor(Date.now() / 1000);
  const result = await verifySessionToken(sign(claims({ exp: now - 10 })), CONFIG, jwks);
  assert.equal(result.ok, false);
});

test("a WRONG azp is refused, which is the CSRF exposure the order names", async () => {
  const result = await verifySessionToken(
    sign(claims({ azp: "https://evil.example" })), CONFIG, jwks,
  );
  assert.equal(result.ok, false);
  const missing = await verifySessionToken(sign(claims({ azp: undefined })), CONFIG, jwks);
  assert.equal(missing.ok, false, "a token with NO azp is refused, not waved through");
});

test("a wrong issuer is refused", async () => {
  const result = await verifySessionToken(
    sign(claims({ iss: "https://other.clerk.accounts.dev" })), CONFIG, jwks,
  );
  assert.equal(result.ok, false);
});

test("a valid session with NO recognised role is authenticated for nothing", async () => {
  for (const metadata of [{}, { role: "superuser" }, undefined]) {
    const result = await verifySessionToken(
      sign(claims({ metadata, role: undefined })), CONFIG, jwks,
    );
    assert.equal(result.ok, false, `metadata=${JSON.stringify(metadata)} must not default to desk`);
  }
});

test("an UNKNOWN kid is refused rather than trusted", async () => {
  const result = await verifySessionToken(sign(claims(), { kid: "not-in-jwks" }), CONFIG, jwks);
  assert.equal(result.ok, false);
});

test("the hierarchy: manager holds desk, admin holds both, never the reverse", () => {
  assert.equal(roleAtLeast("manager", "desk"), true);
  assert.equal(roleAtLeast("admin", "manager"), true);
  assert.equal(roleAtLeast("admin", "desk"), true);
  assert.equal(roleAtLeast("desk", "manager"), false);
  assert.equal(roleAtLeast("desk", "admin"), false);
  assert.equal(roleAtLeast("manager", "admin"), false);
});

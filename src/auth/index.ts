// P2. Clerk session verification, server side. Build Order 4, section P2.
//
// "A frontend that hides a button is not access control." Every refusal in
// this module happens on the API, against the token's SIGNATURE, not against
// anything the client asserts about itself.
//
// HAND-ROLLED RS256 VERIFICATION, deliberately. Clerk's session token is a
// standard JWT signed with the instance's RSA key, published at a JWKS URL.
// Verifying one is: check the header, fetch the key, verify the signature,
// check the times, check azp. Node's crypto does all of it. The alternative,
// @clerk/backend, would be the third runtime dependency in a project that has
// two, to do something the standard library does in a page — and every line
// here is a line the P2 proof can break on purpose.
//
// WHAT THIS TRUSTS: the JWKS endpoint named by configuration, over https, and
// nothing else. Every claim used for authorization is read only AFTER the
// signature verifies. The role claim is expected at `metadata.role` (Clerk
// session token customization: {"metadata": "{{user.public_metadata}}"}), with
// a top-level `role` accepted as the fallback shape.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { KeyObject } from "node:crypto";

export type Role = "desk" | "manager" | "admin";

// The hierarchy in one place. A manager holds everything a desk holds; an
// admin holds everything a manager holds, across branches (King B's
// amendment, 2026-08-18, superseding the order's two-role list).
const RANK: Record<Role, number> = { desk: 1, manager: 2, admin: 3 };

export function roleAtLeast(held: Role, required: Role): boolean {
  return RANK[held] >= RANK[required];
}

export type AuthConfig = {
  // e.g. https://<instance>.clerk.accounts.dev — the token's `iss` must equal
  // it, and the JWKS is fetched from `${issuer}/.well-known/jwks.json`.
  readonly issuer: string;
  // The origins allowed to hold sessions. Omitting azp checking "exposes the
  // app to CSRF" (the order names this) — so empty is INVALID, not permissive.
  readonly authorizedParties: readonly string[];
};

export function authConfigFromEnv(env: NodeJS.ProcessEnv): AuthConfig | undefined {
  const issuer = (env["CLERK_ISSUER"] ?? "").replace(/\/+$/, "");
  const parties = (env["CLERK_AUTHORIZED_PARTIES"] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (issuer === "") return undefined;
  // Issuer without authorized parties is a MISCONFIGURATION, and the honest
  // behaviour is "auth on, every azp-carrying token refused" rather than
  // silently skipping the check. Returning the config with an empty list
  // produces exactly that, because [] matches nothing.
  return { issuer, authorizedParties: parties };
}

type Jwk = { kid?: string; kty?: string; [k: string]: unknown };

// The JWKS cache. Keys rotate rarely; a miss on a known-kid refetches once so
// rotation is picked up without restarting, and an unknown kid cannot force a
// fetch storm because the negative result is cached too.
const keyCache = new Map<string, KeyObject>();
let lastFetch = 0;

export type FetchJwks = (url: string) => Promise<{ keys: Jwk[] }>;

const defaultFetchJwks: FetchJwks = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`jwks fetch failed: ${String(response.status)}`);
  return (await response.json()) as { keys: Jwk[] };
};

async function keyForKid(
  issuer: string,
  kid: string,
  fetchJwks: FetchJwks,
): Promise<KeyObject | undefined> {
  const cached = keyCache.get(kid);
  if (cached !== undefined) return cached;
  // At most one refetch per 60s, so an attacker spraying fabricated kids
  // cannot turn this into a request amplifier against the JWKS host.
  if (Date.now() - lastFetch < 60_000 && keyCache.size > 0) return undefined;
  lastFetch = Date.now();
  const jwks = await fetchJwks(`${issuer}/.well-known/jwks.json`);
  for (const jwk of jwks.keys) {
    if (typeof jwk.kid !== "string") continue;
    try {
      keyCache.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
    } catch {
      // A malformed key in the set must not take down verification of the
      // well-formed ones.
    }
  }
  return keyCache.get(kid);
}

// Test seam: proofs preload keys rather than fetching.
export function primeKeyCache(kid: string, key: KeyObject): void {
  keyCache.set(kid, key);
}
export function clearKeyCache(): void {
  keyCache.clear();
  lastFetch = 0;
}

function b64urlJson(part: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export type Session = {
  readonly userId: string;
  readonly role: Role;
};

export type AuthResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly reason: string };

export async function verifySessionToken(
  token: string,
  config: AuthConfig,
  fetchJwks: FetchJwks = defaultFetchJwks,
): Promise<AuthResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = b64urlJson(headerB64);
  if (header === undefined) return { ok: false, reason: "unreadable header" };

  // ALGORITHM IS PINNED. Accepting the token's own claim about its algorithm
  // is the classic downgrade: alg:none is a forged token that "verifies", and
  // an HS256 token would let the PUBLIC key be used as an HMAC secret. RS256,
  // which is what Clerk signs with, or refusal.
  if (header["alg"] !== "RS256") return { ok: false, reason: "algorithm is not RS256" };
  const kid = header["kid"];
  if (typeof kid !== "string" || kid === "") return { ok: false, reason: "no key id" };

  const key = await keyForKid(config.issuer, kid, fetchJwks);
  if (key === undefined) return { ok: false, reason: "unknown signing key" };

  const signed = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const signature = Buffer.from(signatureB64, "base64url");
  if (!cryptoVerify("RSA-SHA256", signed, key, signature)) {
    return { ok: false, reason: "signature mismatch" };
  }

  // Claims are read ONLY past this line.
  const payload = b64urlJson(payloadB64);
  if (payload === undefined) return { ok: false, reason: "unreadable payload" };

  const now = Math.floor(Date.now() / 1000);
  const exp = payload["exp"];
  if (typeof exp !== "number" || exp <= now) return { ok: false, reason: "token expired" };
  const nbf = payload["nbf"];
  if (typeof nbf === "number" && nbf > now + 5) return { ok: false, reason: "token not yet valid" };

  if (payload["iss"] !== config.issuer) return { ok: false, reason: "wrong issuer" };

  // azp: the origin that holds the session. The order names omitting this as
  // CSRF exposure, so a token with no azp at all is also refused.
  const azp = payload["azp"];
  if (typeof azp !== "string" || !config.authorizedParties.includes(azp)) {
    return { ok: false, reason: "azp is not an authorized party" };
  }

  const sub = payload["sub"];
  if (typeof sub !== "string" || sub === "") return { ok: false, reason: "no subject" };

  const metadata = payload["metadata"];
  const roleClaim =
    typeof metadata === "object" && metadata !== null && "role" in metadata
      ? (metadata as Record<string, unknown>)["role"]
      : payload["role"];
  if (roleClaim !== "desk" && roleClaim !== "manager" && roleClaim !== "admin") {
    // A valid session with NO recognised role is authenticated but authorized
    // for nothing. Refusing here keeps "role missing" from silently becoming
    // "role desk".
    return { ok: false, reason: "no recognised role claim" };
  }

  return { ok: true, session: { userId: sub, role: roleClaim } };
}

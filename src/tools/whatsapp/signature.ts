// Twilio inbound signature validation. P1, Build Order 4.
//
// "Signature validation on the inbound route, so an unsigned request is
// refused."
//
// THIS IS THE ONLY THING STANDING BETWEEN A PUBLIC URL AND A FORGED CUSTOMER.
// The inbound webhook is reachable by anyone who knows the address. Without
// validation, a stranger could POST a fabricated WhatsApp message and join the
// queue as any phone number, confirm someone else's place, or answer their
// survey. Every fairness guarantee in this system is about WHO holds a place in
// line, so an unauthenticated write to that path defeats the product rather
// than merely being untidy.
//
// The algorithm is Twilio's, and it is not negotiable because Twilio is the one
// signing:
//   1. Take the full URL the request arrived at, exactly as Twilio built it.
//   2. For a POST, append every parameter as key then value, sorted by key.
//   3. HMAC-SHA1 that string with the account's auth token, base64 encode it.
//   4. Compare to the X-Twilio-Signature header.
//
// TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT:
//
//   The URL must be the one TWILIO used, including scheme, host and any query
//   string. Behind Railway's proxy the request arrives as http on an internal
//   host, so the public https URL has to be reconstructed or every signature
//   fails. That is configured explicitly rather than inferred.
//
//   The comparison is TIMING SAFE. A byte-by-byte early-exit comparison leaks
//   how much of a guess was right, which over many attempts recovers the
//   signature. crypto.timingSafeEqual is used, with an explicit length check
//   first because it throws on mismatched lengths.

import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

// Exported so a test can assert the expected value without reimplementing the
// algorithm, which would only prove the test agrees with itself.
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Readonly<Record<string, string>>,
): string {
  // Sorted by key, then key and value concatenated with no separator. This is
  // Twilio's scheme exactly; any deviation produces a signature that never
  // matches and a webhook that never works.
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ""), url);

  return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

export function validateTwilioSignature(input: {
  readonly authToken: string | undefined;
  readonly signature: string | undefined;
  readonly url: string;
  readonly params: Readonly<Record<string, string>>;
}): SignatureCheck {
  // An unconfigured token must REFUSE, never pass. Defaulting to "allow when we
  // cannot check" is how a validation layer becomes decorative: it would hold
  // in development and silently open in production the moment a variable was
  // missing.
  if (input.authToken === undefined || input.authToken === "") {
    return { ok: false, reason: "twilio_not_configured: no auth token, so no request can be trusted" };
  }
  if (input.signature === undefined || input.signature === "") {
    return { ok: false, reason: "missing X-Twilio-Signature" };
  }

  const expected = computeTwilioSignature(input.authToken, input.url, input.params);

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signature, "utf8");
  // timingSafeEqual THROWS on differing lengths, so the length check comes
  // first. Length is not secret; the bytes are.
  if (a.length !== b.length) return { ok: false, reason: "signature length mismatch" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  return { ok: true };
}

// The public URL Twilio signed against. Behind a proxy the request's own host
// and protocol are the INTERNAL ones, so trusting them would break every
// signature. Configured explicitly, with the deployed value as the default so a
// misconfiguration fails closed rather than silently validating against the
// wrong string.
export function publicWebhookUrl(env: NodeJS.ProcessEnv): string {
  const base = env["PUBLIC_BASE_URL"] ?? "";
  return base === "" ? "" : `${base.replace(/\/+$/, "")}/api/twilio/inbound`;
}

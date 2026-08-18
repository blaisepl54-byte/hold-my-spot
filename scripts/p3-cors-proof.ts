// P3 CORS proof. Build Order 4, section P3: "CORS restricted to the Netlify
// origin. Not wildcard."
//
// The property has three halves and each is observed over real HTTP against
// the real app: the configured origin is allowed, EVERY other origin is not,
// and an unset variable means NO cross-origin access at all rather than open
// access. The wildcard is asserted absent explicitly, because "restricted"
// implemented as "*" would pass a naive presence check.
//
// The middleware reads its origin at createApp() time, so each configuration
// gets a fresh app on a fresh port. That is the same seam the deploy uses:
// Railway sets the variable, the process starts, the app is built once.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createApp } from "../src/api/index.ts";

type Outcome = "PASS" | "FAIL";
const results: { outcome: Outcome; label: string; evidence: string }[] = [];

function record(outcome: Outcome, label: string, evidence: string): void {
  results.push({ outcome, label, evidence });
  console.log(`[${outcome}] ${label}`);
  console.log(`       ${evidence}`);
}

const NETLIFY = "https://hold-my-spot.netlify.app";
const STRANGER = "https://evil.example";

async function listen(): Promise<{ origin: string; server: Server }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, server };
}

async function probe(base: string, origin: string, method = "GET"): Promise<string | null> {
  const response = await fetch(`${base}/health`, { method, headers: { Origin: origin } });
  await response.arrayBuffer();
  return response.headers.get("access-control-allow-origin");
}

async function main(): Promise<void> {
  console.log("P3 CORS proof\n");
  // /health touches the database; point it at a closed port so this proof
  // needs no database and the header is observable on the error path too,
  // which is where a second, unguarded middleware stack would betray itself.
  process.env["HMS_RO_URL"] = "postgres://unused:unused@127.0.0.1:1/hms";

  // ---- configured: the one origin, and only it -------------------------
  process.env["CORS_ALLOWED_ORIGIN"] = NETLIFY;
  const a = await listen();

  const allowed = await probe(a.origin, NETLIFY);
  record(
    allowed === NETLIFY ? "PASS" : "FAIL",
    "the configured origin is allowed, echoed EXACTLY",
    `Access-Control-Allow-Origin: ${allowed ?? "(absent)"}`,
  );
  record(
    allowed !== "*" ? "PASS" : "FAIL",
    "the header is never the wildcard",
    `got ${allowed ?? "(absent)"}, not "*"`,
  );

  const stranger = await probe(a.origin, STRANGER);
  record(
    stranger === null ? "PASS" : "FAIL",
    "EVERY other origin gets no header, which the browser treats as refusal",
    `for ${STRANGER}: ${stranger ?? "(absent)"}`,
  );

  const preflight = await probe(a.origin, NETLIFY, "OPTIONS");
  const preflightStranger = await probe(a.origin, STRANGER, "OPTIONS");
  record(
    preflight === NETLIFY && preflightStranger === null ? "PASS" : "FAIL",
    "preflight follows the same rule as the request itself",
    `OPTIONS as ${NETLIFY}: ${preflight ?? "(absent)"}; as ${STRANGER}: ${preflightStranger ?? "(absent)"}`,
  );
  await new Promise<void>((resolve) => a.server.close(() => resolve()));

  // ---- break-restore: unset must FAIL CLOSED ---------------------------
  console.log("\n--- break-restore ---");
  delete process.env["CORS_ALLOWED_ORIGIN"];
  const b = await listen();
  const afterBreak = await probe(b.origin, NETLIFY);
  record(
    afterBreak === null ? "PASS" : "FAIL",
    "BREAK: variable unset, the PREVIOUSLY ALLOWED origin loses access",
    afterBreak === null
      ? "RED observed: no header for the origin that was allowed above. Unset means closed, not open."
      : `still emitting ${afterBreak}, so the gate does not depend on the configuration`,
  );
  await new Promise<void>((resolve) => b.server.close(() => resolve()));

  process.env["CORS_ALLOWED_ORIGIN"] = NETLIFY;
  const c = await listen();
  const restored = await probe(c.origin, NETLIFY);
  record(
    restored === NETLIFY ? "PASS" : "FAIL",
    "RESTORE: variable back, the origin is allowed again",
    `Access-Control-Allow-Origin: ${restored ?? "(absent)"}`,
  );
  await new Promise<void>((resolve) => c.server.close(() => resolve()));

  console.log("\n--- summary ---");
  const fail = results.filter((r) => r.outcome === "FAIL").length;
  console.log(`PASS ${String(results.length - fail)}   FAIL ${String(fail)}`);
  if (fail > 0) {
    console.log("\nP3's CORS property is NOT established.");
    process.exitCode = 1;
  } else {
    console.log("\nAll checks PASS. One origin, exact match, fail closed, never wildcard.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

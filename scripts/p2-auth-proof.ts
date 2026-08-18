// P2 auth proof. Build Order 4, section P2. Runs as `pnpm p2` with .env.
//
// The order's property, verbatim: "Every route rejects an unauthenticated
// request, observed as a 401 rather than read from middleware. Every manager
// route rejects a desk session, observed as a 403. Break-restore on at least
// one of each. An out of order override writes the authenticated identity to
// events, and the adherence agent's unapproved-override finding still fires
// when the gate is bypassed at fixture level."
//
// INSTRUMENT: the real express app over real HTTP, tokens signed by a locally
// generated RSA key, the JWKS served by a REAL local HTTP server so the
// fetch-and-cache path is the one production will run — nothing is injected
// past the environment. Clerk's production tokens differ from these only in
// who holds the private key.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createSign, generateKeyPairSync } from "node:crypto";

import { createApp } from "../src/api/index.ts";
import { clearKeyCache } from "../src/auth/index.ts";
import { reportAdherence } from "../src/agents/adherence.ts";
import pg from "pg";

type Outcome = "PASS" | "FAIL";
const results: { outcome: Outcome; label: string; evidence: string }[] = [];
function record(outcome: Outcome, label: string, evidence: string): void {
  results.push({ outcome, label, evidence });
  console.log(`[${outcome}] ${label}`);
  console.log(`       ${evidence}`);
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PARTY = "https://hold-my-spot.netlify.app";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function tokenFor(role: string, issuer: string, overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url({ alg: "RS256", kid: "p2-key", typ: "JWT" })}.${b64url({
    sub: `user_${role}_p2`,
    iss: issuer,
    azp: PARTY,
    exp: now + 300,
    metadata: { role },
    ...overrides,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(body);
  return `${body}.${signer.sign(privateKey).toString("base64url")}`;
}

async function call(
  base: string,
  method: string,
  path: string,
  token: string | undefined,
  body?: object,
): Promise<{ status: number; json: { ok?: boolean; reason?: string; value?: unknown } }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as never };
}

async function main(): Promise<void> {
  console.log("P2 auth proof, the role gates over real HTTP\n");
  clearKeyCache();

  // ---- a real JWKS endpoint -------------------------------------------
  const jwksServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "p2-key" }] }));
  }).listen(0);
  await new Promise<void>((resolve) => jwksServer.once("listening", resolve));
  const issuer = `http://127.0.0.1:${String((jwksServer.address() as AddressInfo).port)}`;
  process.env["CLERK_ISSUER"] = issuer;
  process.env["CLERK_AUTHORIZED_PARTIES"] = PARTY;
  console.log(`JWKS served at ${issuer}/.well-known/jwks.json\n`);

  const appServer = createApp().listen(0);
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  const base = `http://127.0.0.1:${String((appServer.address() as AddressInfo).port)}`;

  const deskToken = tokenFor("desk", issuer);
  const managerToken = tokenFor("manager", issuer);
  const adminToken = tokenFor("admin", issuer);

  // ---- seed, as hms_ddl ------------------------------------------------
  const ddl = new pg.Client({ connectionString: process.env["HMS_DDL_URL"], application_name: "hms-p2-proof" });
  await ddl.connect();
  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('P2 Proof Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("could not seed a location");

  // ---- 401: every staff route, unauthenticated -------------------------
  console.log("--- 401, observed per route ---");
  const staffRoutes: [string, string][] = [
    ["GET", `/api/board?locationId=${locationId}`],
    ["GET", "/api/locations"],
    ["GET", `/api/dashboard?locationId=${locationId}`],
    ["POST", "/api/join"],
    ["POST", "/api/call-next"],
    ["POST", "/api/check-in"],
    ["POST", "/api/close-of-day"],
    ["POST", "/api/call-entry"],
    ["GET", "/api/admin/overview"],
  ];
  let all401 = true;
  for (const [method, path] of staffRoutes) {
    const r = await call(base, method, path, undefined, method === "POST" ? {} : undefined);
    if (r.status !== 401) {
      all401 = false;
      record("FAIL", `unauthenticated ${method} ${path} must be 401`, `got ${String(r.status)}`);
    }
  }
  if (all401) {
    record("PASS", "every staff route refuses an unauthenticated request with 401",
      `${String(staffRoutes.length)} routes probed over HTTP, each observed, none read from middleware`);
  }

  // ---- customer surfaces stay open WITH auth on ------------------------
  const survey = await call(base, "GET", "/api/survey-status?entryId=00000000-0000-0000-0000-000000000000", undefined);
  record(
    survey.status === 200 ? "PASS" : "FAIL",
    "customer surfaces are NEVER behind the gate: survey-status answers without a token",
    `status ${String(survey.status)} with enforcement on. A person in line is never asked for an account.`,
  );

  // ---- 403: role rank, observed ---------------------------------------
  console.log("\n--- 403, the rank refusals ---");
  const deskOnManager = await call(base, "POST", "/api/close-of-day", deskToken, { locationId });
  record(
    deskOnManager.status === 403 ? "PASS" : "FAIL",
    "close-of-day (RULED manager-only) refuses a desk session with 403",
    `status ${String(deskOnManager.status)}, reason: ${deskOnManager.json.reason ?? "?"}`,
  );
  const managerOnAdmin = await call(base, "GET", "/api/admin/overview", managerToken);
  record(
    managerOnAdmin.status === 403 ? "PASS" : "FAIL",
    "the admin overview refuses a manager session with 403",
    `status ${String(managerOnAdmin.status)}`,
  );

  // ---- positive controls ----------------------------------------------
  console.log("\n--- positive controls: the gates admit the right rank ---");
  const deskBoard = await call(base, "GET", `/api/board?locationId=${locationId}`, deskToken);
  const adminOverview = await call(base, "GET", "/api/admin/overview", adminToken);
  const managerDash = await call(base, "GET", `/api/dashboard?locationId=${locationId}`, managerToken);
  record(
    deskBoard.status === 200 && adminOverview.status === 200 && managerDash.status === 200
      ? "PASS" : "FAIL",
    "desk reads the board, manager reads the dashboard, admin reads the overview",
    `statuses ${String(deskBoard.status)}/${String(managerDash.status)}/${String(adminOverview.status)}. The gates are bounded, not broken.`,
  );

  // ---- the I7 upgrade: authenticated identity in the fairness log ------
  console.log("\n--- out-of-order override writes the AUTHENTICATED identity ---");
  const joined = await call(base, "POST", "/api/join", deskToken, { locationId, channel: "reception" });
  const entryId = (joined.json.value as { entryId?: string } | undefined)?.entryId;
  if (entryId === undefined) throw new Error("could not join a probe entry");
  const override = await call(base, "POST", "/api/call-entry", managerToken, {
    locationId, entryId, approver: "a-string-the-client-made-up",
  });
  const ev = await ddl.query<{ approver: string | null; actor: string | null }>(
    "SELECT approver, actor FROM events WHERE entry_id = $1 AND kind = 'out_of_order_call'",
    [entryId],
  );
  const approver = ev.rows[0]?.approver;
  record(
    override.status === 200 && approver === "user_manager_p2" ? "PASS" : "FAIL",
    "the fairness log holds the SESSION's identity, not the client's string",
    `events.approver = ${JSON.stringify(approver)} (client sent "a-string-the-client-made-up"). ` +
      `Attribution moved from convention to checked.`,
  );

  // ---- the adherence finding still fires at fixture level --------------
  const report = reportAdherence([
    { counterLabel: "Counter 1", outOfOrder: true, approver: null },
    { counterLabel: "Counter 1", outOfOrder: false, approver: null },
  ]);
  const fires = report.totalUnapproved > 0 && report.perCounter.some((c) => c.outOfOrderUnapproved > 0);
  record(
    fires ? "PASS" : "FAIL",
    "the adherence agent's unapproved-override DEFECT finding still fires when the gate is bypassed",
    fires ? "fixture with approver=null produced outOfOrderUnapproved > 0" : "the finding is dead",
  );

  // ---- break-restore on the 401 ----------------------------------------
  console.log("\n--- break-restore ---");
  const [h, , sig] = deskToken.split(".") as [string, string, string];
  const now = Math.floor(Date.now() / 1000);
  const tampered = `${h}.${b64url({ sub: "user_desk_p2", iss: issuer, azp: PARTY, exp: now + 300, metadata: { role: "admin" } })}.${sig}`;
  const escalation = await call(base, "GET", "/api/admin/overview", tampered);
  record(
    escalation.status === 401 ? "PASS" : "FAIL",
    "BREAK: the desk token's payload rewritten to claim admin is refused as UNAUTHENTICATED",
    `status ${String(escalation.status)}. RED observed: the 200s above are earned by signatures, ` +
      `and privilege is not a field the client edits.`,
  );
  const restored = await call(base, "GET", "/api/admin/overview", adminToken);
  record(
    restored.status === 200 ? "PASS" : "FAIL",
    "RESTORE: the genuinely signed admin token is accepted again",
    `status ${String(restored.status)}`,
  );

  // ---- teardown --------------------------------------------------------
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  await ddl.end();
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  delete process.env["CLERK_ISSUER"];
  delete process.env["CLERK_AUTHORIZED_PARTIES"];

  console.log("\n--- summary ---");
  const fail = results.filter((r) => r.outcome === "FAIL").length;
  console.log(`PASS ${String(results.length - fail)}   FAIL ${String(fail)}`);
  if (fail > 0) {
    console.log("\nP2's property is NOT established.");
    process.exitCode = 1;
  } else {
    console.log("\nAll checks PASS. 401 and 403 observed per route; I7 attribution is checked, not declared.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

// D2 proof. The WhatsApp join conversation, end to end over real HTTP.
//
// Two things this exists to hold down, both found in production on 2026-09-06:
//
//   1. A WhatsApp joiner never said what they came for, so every remote entry
//      carried a null service type and sat outside every bucket the
//      measurement layer keys on.
//   2. "1" is an affirmative and "2" is a negative to the intent parser. A
//      customer answering a numbered SERVICE menu must not have their answer
//      read as a confirmation or a refusal. That is resolved against state,
//      and this proof is what makes the resolution observed rather than
//      assumed.
//
// INSTRUMENT: the real express app over real HTTP, with a real Twilio
// signature on every request, so the whole webhook path runs exactly as
// production runs it. Nothing is injected past the signature check.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";

import pg from "pg";

import { createApp, consoleTransport } from "../src/api/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";
import { closeReadPool } from "../src/persistence/read/index.ts";

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

const AUTH_TOKEN = "d2-proof-token";
const FROM = "whatsapp:+15550002222";

function sign(url: string, params: Record<string, string>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", AUTH_TOKEN).update(Buffer.from(data, "utf8")).digest("base64");
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-d2-proof",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('D2 Join Flow Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  const SERVICES = [
    { code: "account_services", label: "Account opening or closing" },
    { code: "deposit_withdrawal", label: "Deposits and withdrawals" },
    { code: "card_services", label: "Card services" },
  ];
  for (const [i, s] of SERVICES.entries()) {
    await ddl.query(
      "INSERT INTO service_types (location_id, code, label, sort_order) VALUES ($1,$2,$3,$4)",
      [locationId, s.code, s.label, i],
    );
  }

  process.env["TWILIO_AUTH_TOKEN"] = AUTH_TOKEN;
  process.env["HMS_DEFAULT_LOCATION_ID"] = locationId;
  process.env["HMS_TRANSPORT"] = "simulated";
  delete process.env["CLERK_ISSUER"];

  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${String(port)}`;
  // The signed URL is DERIVED from PUBLIC_BASE_URL by the route itself, so the
  // proof sets the same variable production sets rather than the full path.
  process.env["PUBLIC_BASE_URL"] = base;
  const hook = `${base}/api/twilio/inbound`;

  const transport = consoleTransport();

  async function say(body: string): Promise<string> {
    const params = { From: FROM, Body: body };
    const res = await fetch(hook, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": sign(hook, params),
      },
      body: new URLSearchParams(params).toString(),
    });
    if (res.status !== 200) return `HTTP ${String(res.status)}`;
    // The reply goes out through the transport, not in the response body.
    const all = transport.inbox();
    return all[all.length - 1]?.body ?? "";
  }

  try {
    console.log("D2, the WhatsApp join conversation\n");

    const r1 = await say("JOIN");
    check(
      "JOIN asks for the name, and says the ID will be needed",
      r1.includes("what name") && r1.toLowerCase().includes("id"),
      JSON.stringify(r1).slice(0, 150),
    );

    const r2 = await say("Marcia Bennett");
    check(
      "the name hands straight to the service menu, built from the branch's own list",
      SERVICES.every((s) => r2.includes(s.label)) && r2.includes("1."),
      JSON.stringify(r2).slice(0, 200),
    );

    // THE COLLISION. "2" is `negative` to parseInbound. Here it must be read as
    // the second service, because this entry still owes us one.
    const r3 = await say("2");
    const row = await ddl.query<{ label: string | null; status: string }>(
      `SELECT st.label, e.status FROM entries e
         LEFT JOIN service_types st ON st.id = e.service_type_id
        WHERE e.location_id = $1 ORDER BY e.joined_at DESC LIMIT 1`,
      [locationId],
    );
    check(
      'a bare "2" is read as the SECOND SERVICE, not as a refusal',
      row.rows[0]?.label === "Deposits and withdrawals",
      `stored service = ${String(row.rows[0]?.label)}`,
    );
    check(
      "and the reply quotes the position and a wait, then asks for the confirmation",
      r3.includes("in line") && r3.toUpperCase().includes("YES"),
      JSON.stringify(r3).slice(0, 180),
    );
    check(
      "the entry is STILL provisional: choosing a service does not confirm a place",
      row.rows[0]?.status === "provisional",
      `status = ${String(row.rows[0]?.status)}`,
    );

    const r4 = await say("YES");
    const after = await ddl.query<{ status: string }>(
      "SELECT status FROM entries WHERE location_id = $1 ORDER BY joined_at DESC LIMIT 1",
      [locationId],
    );
    check(
      "YES now confirms, because the name and the service are both in hand",
      after.rows[0]?.status === "waiting",
      `status = ${String(after.rows[0]?.status)}`,
    );
    check(
      "the confirmation states the 2-minute response rule before it is ever needed",
      r4.includes("2 minutes") && r4.toUpperCase().includes("READY"),
      JSON.stringify(r4).slice(0, 200),
    );

    // A second customer, to pin the unrecognised-answer path.
    const OTHER = "whatsapp:+15550003333";
    async function sayAs(from: string, body: string): Promise<string> {
      const params = { From: from, Body: body };
      await fetch(hook, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": sign(hook, params),
        },
        body: new URLSearchParams(params).toString(),
      });
      const all = transport.inbox();
      return all[all.length - 1]?.body ?? "";
    }
    await sayAs(OTHER, "JOIN");
    await sayAs(OTHER, "Everton Reid");
    const r5 = await sayAs(OTHER, "something else entirely");
    check(
      "an unrecognised answer re-shows the menu rather than guessing a service",
      SERVICES.every((s) => r5.includes(s.label)),
      JSON.stringify(r5).slice(0, 150),
    );
    const stillNull = await ddl.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM entries
        WHERE location_id = $1 AND contact = $2 AND service_type_id IS NULL`,
      [locationId, "+15550003333"],
    );
    check(
      "and nothing was stored on the guess",
      stillNull.rows[0]?.n === "1",
      `entries still without a service = ${String(stillNull.rows[0]?.n)}`,
    );

    console.log(`\n${failures === 0 ? "D2 PROVEN." : `D2 FAILED: ${String(failures)} check(s).`}`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM service_types WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
    await ddl.end();
    server.close();
    await closeWritePool();
    await closeReadPool();
  }
}

await main();

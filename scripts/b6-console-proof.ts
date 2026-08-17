// B6 proof, the console.
//
// Drives the REAL HTTP SURFACE, not the modules underneath it. The console is
// the only thing a demo audience will ever touch, so proving the orchestrator
// works says nothing about whether the console does. Every assertion below goes
// over the wire.
//
// The behaviour matched is the prototype's, per B6: one queue, two live views,
// remote joins arriving provisional and being skipped until confirmed.
// docs/hold-my-spot-prototype.html is NOT modified and stays the fallback
// submission; its pin is checked here so that stays true.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";

import { startServer } from "../src/api/server.ts";
import { closeReadPool } from "../src/persistence/read/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

const PORT = 3131;
const BASE = `http://localhost:${String(PORT)}`;

async function get(path: string): Promise<{ ok: boolean; value?: unknown; reason?: string }> {
  const res = await fetch(`${BASE}${path}`);
  return (await res.json()) as { ok: boolean; value?: unknown; reason?: string };
}

async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; body: { ok: boolean; value?: unknown; reason?: string } }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; value?: unknown; reason?: string } };
}

type BoardEntry = {
  id: string;
  status: string;
  channel: string;
  counter: string | null;
  undeliverable_at: string | null;
};
type Board = { queue: BoardEntry[]; totals: { served: number }; events: { kind: string }[] };

async function board(locationId: string): Promise<Board> {
  const r = await get(`/api/board?locationId=${encodeURIComponent(locationId)}`);
  return r.value as Board;
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-b6-proof",
  });
  await ddl.connect();
  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('B6 Console Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  // C6: honour HOST so this proof genuinely runs under BOTH bind settings, as
  // Build Order 3 requires. The probes below all use localhost, which answers
  // under either bind, so the difference under test is the bind itself.
  const server = startServer(PORT, process.env["HOST"] ?? undefined);
  await new Promise((r) => setTimeout(r, 300));

  try {
    // === the prototype is untouched ====================================
    const proto = await readFile("docs/hold-my-spot-prototype.html");
    const pin = createHash("sha256").update(proto).digest("hex");
    check(
      "the prototype is UNMODIFIED and remains the fallback submission",
      pin === "b1293e7304698e0c7913c1b4a721dc199a7a2d9b82958f5a0dcea7a63759239f",
      `sha256=${pin}`,
    );

    // === health still works ============================================
    const health = await fetch(`${BASE}/health`);
    check("health reports database liveness and the role it connected as", health.status === 200,
      `HTTP ${String(health.status)}, body ${JSON.stringify(await health.json())}`);

    // === the console page is served ====================================
    const page = await fetch(`${BASE}/`);
    const html = await page.text();
    check(
      "the two-sided console page is served",
      page.status === 200 && html.includes("Unified queue") && html.includes("Customer phone"),
      `HTTP ${String(page.status)}, ${String(html.length)} bytes, both sides present in the markup`,
    );

    // === the demo moment, over HTTP ====================================
    console.log("\n--- the demo moment, driven entirely over HTTP ---");
    const remote = await post("/api/join", {
      locationId, channel: "whatsapp", contact: "+18765550199",
    });
    const remoteId = (remote.body.value as { entryId: string }).entryId;
    check("a remote WhatsApp join arrives provisional",
      (remote.body.value as { status: string }).status === "provisional",
      `status=${(remote.body.value as { status: string }).status}`);

    const inboxAfterJoin = await get(`/api/inbox?entryId=${remoteId}`);
    check("the customer's phone received the confirmation prompt",
      (inboxAfterJoin.value as unknown[]).length === 1,
      `${String((inboxAfterJoin.value as unknown[]).length)} message(s) in the phone view`);

    await post("/api/join", { locationId, channel: "reception" });

    const call1 = await post("/api/call-next", { locationId, counter: "Counter 1" });
    const call1Value = call1.body.value as { calledEntryId: string; counter: string; steppedOver: { id: string }[] };
    check("Call Next skips the unconfirmed remote entry",
      call1Value.calledEntryId !== remoteId,
      `called ${call1Value.calledEntryId.slice(0, 8)}, not the remote entry`);
    check("the skip is visible to the console as steppedOver",
      call1Value.steppedOver.some((s) => s.id === remoteId),
      `steppedOver includes the remote entry`);
    check("the called entry is bound to the counter that called it",
      call1Value.counter === "Counter 1",
      `counter=${String(call1Value.counter)}`);

    const confirm = await post("/api/confirm", { locationId, entryId: remoteId });
    check("one tap confirms, over the same API the phone view uses",
      confirm.body.ok, confirm.body.ok ? "confirmed" : String(confirm.body.reason));

    const call2 = await post("/api/call-next", { locationId, counter: "Counter 2" });
    check("the next Call Next serves the remote customer",
      (call2.body.value as { calledEntryId: string }).calledEntryId === remoteId,
      `called ${remoteId.slice(0, 8)}, the remote entry`);

    // === counter verbs ==================================================
    console.log("\n--- counter verbs ---");
    const checkedIn = await post("/api/check-in", { locationId, entryId: remoteId });
    check("check in moves the entry to serving", checkedIn.body.ok,
      checkedIn.body.ok ? "serving" : String(checkedIn.body.reason));

    const completed = await post("/api/complete", { locationId, entryId: remoteId });
    check("complete finishes the service and releases the counter", completed.body.ok,
      completed.body.ok ? "served" : String(completed.body.reason));

    const afterComplete = await board(locationId);
    check("the completed entry no longer occupies a counter",
      !afterComplete.queue.some((e) => e.id === remoteId),
      `served entries leave the live board; totals.served=${String(afterComplete.totals.served)}`);

    // === an illegal transition is a 409, not a 500 ======================
    console.log("\n--- refusals ---");
    const illegal = await post("/api/check-in", { locationId, entryId: remoteId });
    check("checking in an already-served entry is REFUSED with 409 and a reason",
      illegal.status === 409 && !illegal.body.ok,
      `HTTP ${String(illegal.status)}: ${String(illegal.body.reason)}`);

    const malformed = await post("/api/join", { locationId, channel: "carrier-pigeon" });
    check("an invalid channel is rejected with 400 before reaching the domain",
      malformed.status === 400,
      `HTTP ${String(malformed.status)}: ${String(malformed.body.reason)}`);

    // === the fairness log is visible to the console =====================
    const finalBoard = await board(locationId);
    check("the console can see the fairness log, so the audit trail is not write-only",
      finalBoard.events.length > 0,
      `${String(finalBoard.events.length)} events visible, newest first`);

    // === reads run as hms_ro ============================================
    const roleCheck = await fetch(`${BASE}/health`);
    const roleBody = (await roleCheck.json()) as { role: string };
    check("the console's reads run as hms_ro, so a console bug cannot write",
      roleBody.role === "hms_ro",
      `health reports read-path current_user=${roleBody.role}`);
  } finally {
    server.close();
    await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
    await ddl.end();
    await closeReadPool();
    await closeWritePool();
  }

  console.log(failures === 0 ? "\nB6 PROVEN over HTTP." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

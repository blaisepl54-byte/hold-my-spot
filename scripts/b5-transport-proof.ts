// B5 proof, transport.
//
// "Twilio WhatsApp sandbox, with the simulated WhatsApp surface built in
// parallel as a fallback capable of carrying the demo alone. Neither becomes
// the only path."
//
// Proven here against the live database:
//   - the simulated surface carries the whole prompt flow ALONE
//   - X8's bounded retry: two failures then a success, no undeliverable
//   - X8's exhaustion: three failures -> undeliverable_at set, and the STATUS
//     STAYS provisional, per the ruling of 2026-08-15
//   - an unreachable entry is still a normal provisional entry: it holds its
//     place and is still skipped by Call Next
//   - a prompt writes NO fairness event, because nobody's place moved
//   - selecting Twilio with no account degrades to a clean refusal and does not
//     break the queue, which is the other half of "neither is the only path"

import pg from "pg";

import {
  callNext,
  joinQueue,
  sendConfirmationPrompt,
} from "../src/orchestrator/apply/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";
import { SimulatedTransport } from "../src/tools/whatsapp/simulated.ts";
import { TwilioTransport } from "../src/tools/whatsapp/twilio.ts";

let failures = 0;

function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-b5-proof",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('B5 Transport Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  const cols = async (id: string) => {
    const r = await ddl.query<{
      status: string;
      prompt_sent_at: Date | null;
      prompt_delivered_at: Date | null;
      prompt_failed_at: Date | null;
      undeliverable_at: Date | null;
    }>(
      `SELECT status, prompt_sent_at, prompt_delivered_at, prompt_failed_at, undeliverable_at
         FROM entries WHERE id = $1`,
      [id],
    );
    return r.rows[0];
  };

  // === happy path, simulated carries it alone ===========================
  console.log("=== the simulated surface, carrying the demo alone ===");
  const happy = new SimulatedTransport();
  const a = await joinQueue({
    locationId,
    channel: "whatsapp",
    contact: "+18765550100",
    actor: "customer",
  });
  if (!a.ok) throw new Error(a.reason);

  const sent = await sendConfirmationPrompt({
    entryId: a.value.entryId,
    locationId,
    transport: happy,
  });
  const aCols = await cols(a.value.entryId);
  check(
    "a prompt is sent and delivered through the simulated surface",
    sent.ok && sent.value.sent && sent.value.delivered,
    sent.ok ? `attempts=${String(sent.value.attempts)} delivered=${String(sent.value.delivered)}` : sent.reason,
  );
  check(
    "prompt_sent_at and prompt_delivered_at are both recorded",
    aCols?.prompt_sent_at !== null && aCols?.prompt_delivered_at !== null,
    `sent_at=${String(aCols?.prompt_sent_at)} delivered_at=${String(aCols?.prompt_delivered_at)}`,
  );
  check(
    "the customer can read the message back, so the surface is a real fallback",
    happy.inbox(a.value.entryId).length === 1,
    `inbox: "${String(happy.inbox(a.value.entryId)[0]?.body)}"`,
  );

  // === X8 bounded retry =================================================
  console.log("\n=== X8: bounded retry, two failures then success ===");
  const flaky = new SimulatedTransport({ failAttempts: [1, 2] });
  const b = await joinQueue({
    locationId,
    channel: "whatsapp",
    contact: "+18765550101",
  });
  if (!b.ok) throw new Error(b.reason);

  const retried = await sendConfirmationPrompt({
    entryId: b.value.entryId,
    locationId,
    transport: flaky,
  });
  const bCols = await cols(b.value.entryId);
  check(
    "the third attempt succeeds within the bound of 3",
    retried.ok && retried.value.sent && retried.value.attempts === 3,
    retried.ok ? `attempts=${String(retried.value.attempts)} sent=${String(retried.value.sent)}` : retried.reason,
  );
  check(
    "a recovered entry is NOT marked undeliverable",
    bCols?.undeliverable_at === null,
    `undeliverable_at=${String(bCols?.undeliverable_at)}`,
  );

  // === X8 exhaustion ====================================================
  console.log("\n=== X8: all attempts fail, the entry becomes unreachable ===");
  const dead = new SimulatedTransport({ failAttempts: [1, 2, 3] });
  const c = await joinQueue({
    locationId,
    channel: "whatsapp",
    contact: "+18765550102",
  });
  if (!c.ok) throw new Error(c.reason);

  const exhausted = await sendConfirmationPrompt({
    entryId: c.value.entryId,
    locationId,
    transport: dead,
  });
  const cCols = await cols(c.value.entryId);
  check(
    "three attempts are made and the bound is not exceeded",
    exhausted.ok && exhausted.value.attempts === 3 && !exhausted.value.sent,
    exhausted.ok ? `attempts=${String(exhausted.value.attempts)} sent=${String(exhausted.value.sent)}` : exhausted.reason,
  );
  check(
    "undeliverable_at is set, so the entry has a clock rather than sitting forever",
    cCols?.undeliverable_at !== null,
    `undeliverable_at=${String(cCols?.undeliverable_at)}`,
  );
  check(
    "the STATUS STAYS provisional (ruling 2026-08-15: undeliverable is a column)",
    cCols?.status === "provisional",
    `status=${String(cCols?.status)}, not a status called undeliverable`,
  );
  check(
    "prompt_failed_at is recorded",
    cCols?.prompt_failed_at !== null,
    `prompt_failed_at=${String(cCols?.prompt_failed_at)}`,
  );

  // === an unreachable entry is still an ordinary provisional entry ======
  console.log("\n=== the unreachable entry behaves like any other provisional entry ===");
  const onsite = await joinQueue({ locationId, channel: "reception" });
  if (!onsite.ok) throw new Error(onsite.reason);

  const call = await callNext({ locationId, actor: "operator" });
  check(
    "Call Next steps over the unreachable entry, exactly as it would any unconfirmed one",
    call.ok && call.value.steppedOver.some((s) => s.id === c.value.entryId),
    call.ok
      ? `steppedOver includes the unreachable entry: ${String(call.value.steppedOver.some((s) => s.id === c.value.entryId))}`
      : call.reason,
  );

  // === prompts write no fairness events ==================================
  const promptEvents = await ddl.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM events
      WHERE location_id = $1 AND kind IN ('prompt_sent', 'prompt_failed', 'undeliverable')`,
    [locationId],
  );
  check(
    "a prompt writes NO fairness event, because nobody's place in line moved",
    promptEvents.rows[0]?.n === "0",
    `prompt-shaped events in the fairness log: ${String(promptEvents.rows[0]?.n)}`,
  );

  // === neither transport is the only path ================================
  console.log("\n=== neither transport is the only path ===");
  const d = await joinQueue({
    locationId,
    channel: "whatsapp",
    contact: "+18765550103",
  });
  if (!d.ok) throw new Error(d.reason);

  const unconfigured = await sendConfirmationPrompt({
    entryId: d.value.entryId,
    locationId,
    transport: new TwilioTransport(undefined),
  });
  const dCols = await cols(d.value.entryId);
  check(
    "selecting Twilio with no account refuses cleanly instead of throwing",
    unconfigured.ok && !unconfigured.value.sent,
    unconfigured.ok
      ? `sent=false, lastReason="${String(unconfigured.value.lastReason).slice(0, 60)}..."`
      : unconfigured.reason,
  );
  check(
    "and the queue is undamaged: the entry is still provisional and still in line",
    dCols?.status === "provisional",
    `status=${String(dCols?.status)}`,
  );

  const stillWorks = await callNext({ locationId, actor: "operator" });
  check(
    "the queue keeps operating after a transport refusal",
    stillWorks.ok,
    stillWorks.ok ? `called ${String(stillWorks.value.calledEntryId)}` : stillWorks.reason,
  );

  // === teardown ==========================================================
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  await ddl.end();
  await closeWritePool();

  console.log(failures === 0 ? "\nB5 PROVEN. The simulated surface carries the demo alone." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

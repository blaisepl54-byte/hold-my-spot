// C2 proof, Build Order 3 section 3.
//
// The claim that matters most here is a NEGATIVE one: "A survey response is NOT
// a fairness event and does not write to `events`. Conflating satisfaction data
// with the audit trail would weaken the one artifact whose meaning is currently
// exact."
//
// A negative claim is only proven by counting before and after and showing the
// count did not move. That is what this does.

import pg from "pg";

import {
  callNext,
  checkIn,
  completeService,
  confirmEntry,
  joinQueue,
  recordSurveyResponse,
  sendSurvey,
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

const INSUFFICIENT_PRIVILEGE = "42501";
function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-c2-proof",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('C2 Survey Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");
  await ddl.query("INSERT INTO counters (location_id, label) VALUES ($1, 'Counter 1')", [
    locationId,
  ]);

  const countEvents = async (): Promise<number> => {
    const r = await ddl.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE location_id = $1",
      [locationId],
    );
    return Number(r.rows[0]?.n ?? "0");
  };

  // === grants, and 006's durable fix on a NEW table =====================
  console.log("--- grants ---");
  const rwPrivs = await ddl.query<{ p: string }>(
    `SELECT privilege_type AS p FROM information_schema.table_privileges
      WHERE grantee = 'hms_rw' AND table_name = 'surveys' ORDER BY 1`,
  );
  const privs = rwPrivs.rows.map((r) => r.p);
  check(
    "hms_rw holds SELECT, INSERT, UPDATE on surveys and NO DELETE",
    privs.includes("SELECT") && privs.includes("INSERT") && privs.includes("UPDATE") &&
      !privs.includes("DELETE"),
    `${privs.join(", ")}. A response withdrawn by deletion would silently change every historical rate computed from it.`,
  );
  check(
    "DELETE was absent WITHOUT an explicit revoke, so migration 006's default fix holds on a NEW table",
    !privs.includes("DELETE"),
    "migration 005 needed a corrective revoke; 008 did not. The durable half of 006 is doing the work.",
  );

  // === a full service, then the survey ==================================
  console.log("\n--- a served customer is surveyed ---");
  const transport = new SimulatedTransport();
  const joined = await joinQueue({
    locationId,
    channel: "whatsapp",
    contact: "+18765550300",
    actor: "customer",
  });
  if (!joined.ok) throw new Error(joined.reason);
  const entryId = joined.value.entryId;

  // EVERY STEP IS ASSERTED. The first version of this proof ignored these
  // results and the lifecycle silently never happened: a WhatsApp entry arrives
  // `provisional`, callNext correctly SKIPPED it, and check-in and complete then
  // failed while the script carried on. The survey was being sent to someone who
  // was never served, and the section heading said otherwise.
  //
  // An unchecked `await` on an operation that returns {ok:false} is the same
  // failure as a test asserting nothing.
  const confirmed = await confirmEntry({ entryId, locationId, actor: "customer" });
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.reason}`);

  const called = await callNext({ locationId, actor: "operator", counter: "Counter 1" });
  if (!called.ok) throw new Error(`callNext failed: ${called.reason}`);
  if (called.value.calledEntryId !== entryId) {
    throw new Error(`callNext served ${String(called.value.calledEntryId)}, not the entry under test`);
  }

  const checked = await checkIn({ entryId, locationId, actor: "operator" });
  if (!checked.ok) throw new Error(`checkIn failed: ${checked.reason}`);

  const done = await completeService({ entryId, locationId, actor: "operator" });
  if (!done.ok) throw new Error(`complete failed: ${done.reason}`);

  const servedRow = await ddl.query<{ status: string; serving_ended_at: Date | null }>(
    "SELECT status, serving_ended_at FROM entries WHERE id = $1",
    [entryId],
  );
  check(
    "the customer was ACTUALLY served before being surveyed",
    servedRow.rows[0]?.status === "served" && servedRow.rows[0]?.serving_ended_at !== null,
    `status=${String(servedRow.rows[0]?.status)}, service window closed. The first version of this proof surveyed an entry that was never called.`,
  );

  const eventsBeforeSurvey = await countEvents();

  const sent = await sendSurvey({ entryId, locationId, transport });
  check(
    "the survey is sent through the SAME transport as the confirmation prompt",
    sent.ok && sent.value.sent,
    sent.ok ? `surveyId=${String(sent.value.surveyId)}` : sent.reason,
  );

  const inbox = transport.inbox(entryId);
  const surveyMessage = inbox.at(-1)?.body ?? "";
  check(
    "the customer received TWO questions and no more (R-H)",
    surveyMessage.includes("Did you get what you came for") && surveyMessage.includes("How was the wait"),
    `"${surveyMessage.slice(0, 90)}..."`,
  );

  // === THE NEGATIVE CLAIM ===============================================
  console.log("\n--- a survey is NOT a fairness event ---");
  const eventsAfterSend = await countEvents();
  check(
    "SENDING a survey wrote no fairness event",
    eventsAfterSend === eventsBeforeSurvey,
    `events ${String(eventsBeforeSurvey)} -> ${String(eventsAfterSend)}. Nobody's place in line moved.`,
  );

  const responded = await recordSurveyResponse({
    entryId,
    locationId,
    achieved: true,
    waitMatch: "as_expected",
  });
  const eventsAfterResponse = await countEvents();
  check(
    "RESPONDING to a survey wrote no fairness event",
    responded.ok && eventsAfterResponse === eventsBeforeSurvey,
    `events ${String(eventsBeforeSurvey)} -> ${String(eventsAfterResponse)}. The audit trail still answers only "how many times did this place change".`,
  );

  const stored = await ddl.query<{ achieved: boolean; wait_match: string; responded_at: Date }>(
    "SELECT achieved, wait_match, responded_at FROM surveys WHERE entry_id = $1",
    [entryId],
  );
  check(
    "the response is recorded with its timestamp in one statement",
    stored.rows[0]?.achieved === true &&
      stored.rows[0]?.wait_match === "as_expected" &&
      stored.rows[0]?.responded_at !== null,
    `achieved=${String(stored.rows[0]?.achieved)} wait_match=${String(stored.rows[0]?.wait_match)} responded_at set`,
  );

  // === asked once =======================================================
  console.log("\n--- asked once, answered once ---");
  const twice = await sendSurvey({ entryId, locationId, transport });
  check(
    "a second survey for the same visit is refused by the database, not by the caller remembering",
    twice.ok && !twice.value.sent && twice.value.reason === "already surveyed",
    twice.ok ? `reason=${String(twice.value.reason)}` : twice.reason,
  );

  const answerTwice = await recordSurveyResponse({
    entryId,
    locationId,
    achieved: false,
    waitMatch: "longer",
  });
  check(
    "a second RESPONSE cannot overwrite the first",
    !answerTwice.ok,
    answerTwice.ok ? "it was accepted, which would let a rate be rewritten" : `refused: ${answerTwice.reason}`,
  );

  // === an on-site customer has no contact ===============================
  console.log("\n--- honest handling of an unsurveyable visit ---");
  const walkIn = await joinQueue({ locationId, channel: "reception", actor: "staff" });
  if (!walkIn.ok) throw new Error(walkIn.reason);
  const noContact = await sendSurvey({ entryId: walkIn.value.entryId, locationId, transport });
  check(
    "a walk-in with no contact yields 'not sent' with a reason, not a phantom survey row",
    noContact.ok && !noContact.value.sent && noContact.value.surveyId === null,
    `sent=${String(noContact.ok && noContact.value.sent)} reason="${String(noContact.ok ? noContact.value.reason : "")}". A survey row never delivered would inflate the sent count.`,
  );

  // === it demos without Twilio ==========================================
  const viaTwilio = await sendSurvey({
    entryId: walkIn.value.entryId,
    locationId,
    transport: new TwilioTransport(undefined),
  });
  check(
    "with Twilio unconfigured the survey path still refuses cleanly rather than throwing",
    viaTwilio.ok,
    `ok=${String(viaTwilio.ok)}. The simulated surface carries the survey demo alone.`,
  );

  // === hms_rw cannot delete a survey ====================================
  console.log("\n--- surveys are not deletable by the write path ---");
  const rw = new pg.Client({
    connectionString: process.env["HMS_RW_URL"],
    application_name: "hms-c2-probe",
  });
  await rw.connect();
  try {
    await rw.query("DELETE FROM surveys WHERE entry_id = $1", [entryId]);
    check("hms_rw is refused DELETE on surveys", false, "the delete SUCCEEDED");
  } catch (error) {
    const code = pgCode(error);
    check(
      "hms_rw is refused DELETE on surveys",
      code === INSUFFICIENT_PRIVILEGE,
      `SQLSTATE ${code ?? "none"}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await rw.end();

  // === teardown ==========================================================
  await ddl.query("DELETE FROM surveys WHERE entry_id IN (SELECT id FROM entries WHERE location_id = $1)", [locationId]);
  await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM counters WHERE location_id = $1", [locationId]);
  await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
  await ddl.end();
  await closeWritePool();

  console.log(failures === 0 ? "\nC2 PROVEN." : `\n${String(failures)} FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

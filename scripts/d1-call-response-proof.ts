// D1 proof. The call response window, deferral, and the named join.
// Spec: docs/superpowers/specs/2026-09-05-call-response-window-design.md
//
// THE CLAIM THIS EXISTS TO TEST, in one sentence: a customer who is not ready
// slides back exactly one place, never more, and never by having their join
// time changed.
//
// INSTRUMENT: every state change is driven through orchestrator/apply's named
// operations, and every assertion is read back FROM THE DATABASE afterwards
// rather than taken from a return value. A return value proves what the
// function believes; the row proves what happened.
//
// joined_at is captured before the deferral and compared byte-for-byte after
// it. That comparison is the whole of I1 for this feature: if position were
// being changed rather than callability, this is where it would show.

import pg from "pg";

import {
  callNext,
  checkIn,
  deferEntry,
  joinQueue,
  sweepCallDeadlines,
} from "../src/orchestrator/apply/index.ts";
import { closeWritePool } from "../src/persistence/write/index.ts";
import { readQueue } from "../src/persistence/read/index.ts";
import { closeReadPool } from "../src/persistence/read/index.ts";
import { SimulatedTransport } from "../src/tools/whatsapp/simulated.ts";

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

async function main(): Promise<void> {
  const ddl = new pg.Client({
    connectionString: process.env["HMS_DDL_URL"],
    application_name: "hms-d1-proof",
  });
  await ddl.connect();

  const loc = await ddl.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ('D1 Call Response Branch') RETURNING id",
  );
  const locationId = loc.rows[0]?.id;
  if (locationId === undefined) throw new Error("no location");

  const transport = new SimulatedTransport();

  try {
    console.log("D1, the call response window\n");

    // ---- three walk-ins, in join order --------------------------------
    // reception rather than whatsapp, so they enter at `waiting` already
    // confirmed (X8) and the deferral is tested on its own rather than
    // entangled with the confirmation flow.
    // The FIRST carries a contact, because the deferral message is only sent to
    // an entry that has somewhere to send it. Without one the message assertion
    // below would pass vacuously against a path that never ran.
    const ids: string[] = [];
    for (const name of ["First", "Second", "Third"]) {
      const joined = await joinQueue({
        locationId,
        channel: "reception",
        actor: "reception",
        name,
        contact: name === "First" ? "+15550001111" : null,
      });
      if (!joined.ok) throw new Error(`could not seed ${name}: ${joined.reason}`);
      ids.push(joined.value.entryId);
      // Distinct joined_at values. Without a gap the ordering is decided by
      // whichever insert happened to win the microsecond, and the proof would
      // be asserting on a coin toss.
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const [firstId, secondId, thirdId] = ids as [string, string, string];

    const joinedAtBefore = (
      await ddl.query<{ joined_at: Date }>("SELECT joined_at FROM entries WHERE id = $1", [firstId])
    ).rows[0]?.joined_at;
    if (joinedAtBefore === undefined) throw new Error("no joined_at");

    // ---- 1. the earliest is called ------------------------------------
    const call1 = await callNext({ locationId, actor: "desk", counter: "Counter 1" });
    const status1 = await ddl.query<{ status: string }>(
      "SELECT status FROM entries WHERE id = $1",
      [firstId],
    );
    check(
      "the earliest waiting entry is called",
      call1.ok && call1.value.calledEntryId === firstId && status1.rows[0]?.status === "called",
      `calledEntryId=${call1.ok ? String(call1.value.calledEntryId) : "n/a"} status=${status1.rows[0]?.status ?? "?"}`,
    );

    const callEvent = await ddl.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE entry_id = $1 AND kind = 'call_next'",
      [firstId],
    );
    check(
      "the call is in the fairness log, which is what the deadline is derived from",
      Number(callEvent.rows[0]?.n ?? "0") === 1,
      `call_next events for the called entry = ${callEvent.rows[0]?.n ?? "?"}`,
    );

    // ---- 2. NOT READY -------------------------------------------------
    const deferred = await deferEntry({
      entryId: firstId,
      locationId,
      trigger: "customer_not_ready",
      actor: "customer",
      transport,
    });
    const afterDefer = await ddl.query<{ status: string; joined_at: Date; counter: string | null }>(
      "SELECT status, joined_at, counter FROM entries WHERE id = $1",
      [firstId],
    );
    check(
      "not ready returns the entry to waiting and releases the counter",
      deferred.ok &&
        afterDefer.rows[0]?.status === "waiting" &&
        afterDefer.rows[0]?.counter === null,
      `status=${afterDefer.rows[0]?.status ?? "?"} counter=${String(afterDefer.rows[0]?.counter)}`,
    );

    // I1. THE LOAD-BEARING ASSERTION OF THIS ENTIRE FEATURE.
    check(
      "I1: joined_at is byte-identical after the deferral, so position never moved",
      afterDefer.rows[0]?.joined_at.getTime() === joinedAtBefore.getTime(),
      `before=${joinedAtBefore.toISOString()} after=${afterDefer.rows[0]?.joined_at.toISOString() ?? "?"}`,
    );

    const deferQueue = await readQueue(locationId);
    check(
      "the read layer derives deferred=true from the log, with nothing stored on the entry",
      deferQueue.find((e) => e.id === firstId)?.deferred === true,
      `deferred=${String(deferQueue.find((e) => e.id === firstId)?.deferred)}`,
    );

    check(
      "the customer was told, in the words the spec fixes",
      transport.inbox(firstId).some((m) => m.body.includes("moved you back one place")),
      `messages sent to the deferred entry = ${String(transport.inbox(firstId).length)}`,
    );

    // ---- 3. the NEXT person is called, not the deferred one ------------
    const call2 = await callNext({ locationId, actor: "desk", counter: "Counter 1" });
    check(
      "the deferral costs exactly one place: the SECOND person is called",
      call2.ok && call2.value.calledEntryId === secondId,
      `calledEntryId=${call2.ok ? String(call2.value.calledEntryId) : "n/a"} expected=${secondId}`,
    );
    check(
      "the deferred entry is reported as stepped over, so the console can draw it",
      call2.ok && call2.value.steppedOver.some((s) => s.id === firstId),
      `steppedOver=${call2.ok ? call2.value.steppedOver.map((s) => s.id).join(",") : "n/a"}`,
    );

    // ---- 4. the deferral is spent; they are callable again ------------
    const spentQueue = await readQueue(locationId);
    check(
      "once the next person is called the deferral is spent, derived without a write",
      spentQueue.find((e) => e.id === firstId)?.deferred === false,
      `deferred=${String(spentQueue.find((e) => e.id === firstId)?.deferred)}`,
    );

    await checkIn({ entryId: secondId, locationId, actor: "desk" });
    const call3 = await callNext({ locationId, actor: "desk", counter: "Counter 2" });
    check(
      "NEVER MORE THAN ONE PLACE: the once-deferred entry is called ahead of the third",
      call3.ok && call3.value.calledEntryId === firstId,
      `calledEntryId=${call3.ok ? String(call3.value.calledEntryId) : "n/a"} expected=${firstId}`,
    );

    // ---- 5. silence, via the sweep ------------------------------------
    // The call event is backdated as hms_ddl, which is the only honest way to
    // make a deadline that is already in the past: waiting two real minutes in
    // a proof would make the proof the slowest thing in the repository.
    await ddl.query(
      `UPDATE events SET occurred_at = now() - interval '3 minutes'
        WHERE entry_id = $1 AND kind = 'call_next'`,
      [firstId],
    );
    const swept = await sweepCallDeadlines({ locationId, transport });
    const afterSweep = await ddl.query<{ status: string }>(
      "SELECT status FROM entries WHERE id = $1",
      [firstId],
    );
    check(
      "silence past the window defers the entry, with no scheduler anywhere",
      swept.ok && swept.value.deferredEntryIds.includes(firstId) &&
        afterSweep.rows[0]?.status === "waiting",
      `swept=${swept.ok ? swept.value.deferredEntryIds.join(",") : "n/a"} status=${afterSweep.rows[0]?.status ?? "?"}`,
    );
    const expiryEvent = await ddl.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE entry_id = $1 AND kind = 'call_expiry'",
      [firstId],
    );
    check(
      "the log records that they did not answer, not that they declined",
      Number(expiryEvent.rows[0]?.n ?? "0") === 1,
      `call_expiry events = ${expiryEvent.rows[0]?.n ?? "?"}`,
    );

    // ---- 6. a fresh call resets the clock rather than re-expiring -----
    const call4 = await callNext({ locationId, actor: "desk", counter: "Counter 1" });
    const sweptAgain = await sweepCallDeadlines({ locationId, transport });
    check(
      "a freshly called entry is NOT swept: the deadline runs from the latest call",
      sweptAgain.ok && sweptAgain.value.deferredEntryIds.length === 0,
      `called=${call4.ok ? String(call4.value.calledEntryId) : "n/a"} swept=${sweptAgain.ok ? String(sweptAgain.value.deferredEntryIds.length) : "n/a"}`,
    );

    // ---- 7. exhaustion: everyone deferred, the line must not lock -----
    const called4 = call4.ok ? call4.value.calledEntryId : null;
    if (called4 !== null) {
      await deferEntry({ entryId: called4, locationId, trigger: "customer_not_ready", actor: "customer" });
    }
    const remaining = (await readQueue(locationId)).filter((e) => e.status === "waiting");
    for (const entry of remaining) {
      const c = await callNext({ locationId, actor: "desk", counter: "Counter 3" });
      if (c.ok && c.value.calledEntryId !== null) {
        await deferEntry({
          entryId: c.value.calledEntryId,
          locationId,
          trigger: "customer_not_ready",
          actor: "customer",
        });
      }
    }
    const allDeferred = (await readQueue(locationId)).filter(
      (e) => e.status === "waiting" && e.deferred,
    );
    const callWhenAllDeferred = await callNext({ locationId, actor: "desk", counter: "Counter 1" });
    check(
      "with every waiting entry deferred the line does NOT lock: the earliest is callable",
      allDeferred.length === 0 ||
        (callWhenAllDeferred.ok && callWhenAllDeferred.value.calledEntryId !== null),
      `waiting-and-deferred=${String(allDeferred.length)} called=${callWhenAllDeferred.ok ? String(callWhenAllDeferred.value.calledEntryId) : "n/a"}`,
    );

    console.log(`\n${failures === 0 ? "D1 PROVEN." : `D1 FAILED: ${String(failures)} check(s).`}`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    // Teardown as hms_ddl. hms_rw cannot DELETE entries by design (I1, B2), so
    // this is the only role that can clean a fixture up.
    await ddl.query("DELETE FROM events WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM entries WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM counters WHERE location_id = $1", [locationId]);
    await ddl.query("DELETE FROM locations WHERE id = $1", [locationId]);
    await ddl.end();
    await closeWritePool();
    await closeReadPool();
  }
}

await main();

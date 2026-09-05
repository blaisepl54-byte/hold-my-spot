# Call Response Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A called customer is notified over WhatsApp, has 2 minutes to reply READY or NO, and on "not ready" or silence slides back exactly one place without ever changing their join time.

**Architecture:** Deferral is DERIVED from the append-only `events` log, never stored, so no column and no grant changes. Two new `called → waiting` transitions carry it. The 2-minute deadline is evaluated lazily by a named operation in `orchestrator/apply/` invoked from the board read and from Call Next, because this codebase has no scheduler and this feature does not add one.

**Tech Stack:** TypeScript with `erasableSyntaxOnly`, Node 24.15.0, `node:test`, `pg`, Express 5, PostgreSQL 18. Zero test dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-call-response-window-design.md`

## Global Constraints

- **I1 is inviolable.** `joined_at` is never written by any code in this plan. `hms_rw` cannot write it and that stays true.
- **No migration, no schema change, no grant change.** If any task appears to need one, STOP and report.
- **The status set stays at seven.** Deferral is not a status.
- **R-G:** every customer-facing wait figure comes from `renderEstimate` and is a range, or the honest refusal. Never a point value.
- **Purity:** `src/domain/`, `src/agents/`, `src/synthetic/`, `src/governance/` import no package, no node builtin, and nothing from `src/`. `node scripts/boundary-check.ts` enforces this and must stay green.
- **Only `src/orchestrator/apply/` writes `entries`** (CO-2). New write paths go there or the boundary check fails.
- **Never commit without King B's explicit go.** Stage and propose; do not run `git commit`.
- **`CALL_RESPONSE_SECONDS = 120`.** Not `location.grace_seconds` (300), which means something else.
- Message copy is verbatim from spec section 5. Do not paraphrase it.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/index.ts` (modify) | Two new transitions, `CALL_RESPONSE_SECONDS`, deferral-aware `selectNextToCall`, `callDeadlinePassed` |
| `src/persistence/read/index.ts` (modify) | Derive `deferred` per queue entry from the events log |
| `src/orchestrator/apply/index.ts` (modify) | `deferEntry`, `sweepCallDeadlines`, call-notification send, completion line |
| `src/tools/whatsapp/inbound.ts` (modify) | One keyword: `ready` joins the YES list |
| `src/api/index.ts` (modify) | Sweep invocation, intent resolution against `called`, two-step named join |
| `web/console/index.html` (modify) | Render a deferred entry on the existing detour rail |
| `tests/domain.test.ts` (modify) | Pure unit tests for transitions, skip logic, deadline arithmetic |
| `scripts/d1-call-response-proof.ts` (create) | Live round-trip proof with a break-first RED |

---

### Task 1: Domain — transitions, deadline, deferral-aware selection

**Files:**
- Modify: `src/domain/index.ts`
- Test: `tests/domain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CALL_RESPONSE_SECONDS: number`; `callDeadlinePassed(calledAt: Date, now: Date, windowSeconds?: number): boolean`; `QueueEntry` gains `readonly deferred?: boolean`; `selectNextToCall` skips deferred entries.

- [ ] **Step 1: Write the failing tests**

Append to `tests/domain.test.ts`:

```typescript
import { CALL_RESPONSE_SECONDS, callDeadlinePassed } from "../src/domain/index.ts";

const at = (iso: string): Date => new Date(iso);

test("both deferral transitions exist, called -> waiting, ungated", () => {
  for (const trigger of ["customer_not_ready", "call_expiry"] as const) {
    const check = checkTransition("called", "waiting", trigger, null);
    assert.equal(check.ok, true, `${trigger} should be permitted without an approver`);
  }
});

test("deferral does not invent a status", () => {
  const statuses = new Set<string>();
  for (const t of TRANSITIONS) {
    if (t.from !== null) statuses.add(t.from);
    statuses.add(t.to);
  }
  assert.equal(statuses.size, 7);
});

test("the response window is 2 minutes and is not the grace window", () => {
  assert.equal(CALL_RESPONSE_SECONDS, 120);
});

test("the deadline has not passed at 119 seconds and has at 121", () => {
  const called = at("2026-09-05T10:00:00Z");
  assert.equal(callDeadlinePassed(called, at("2026-09-05T10:01:59Z")), false);
  assert.equal(callDeadlinePassed(called, at("2026-09-05T10:02:01Z")), true);
});

test("selectNextToCall steps over a deferred entry and takes the next", () => {
  const entries: QueueEntry[] = [
    { id: "a", status: "waiting", joinedAt: at("2026-09-05T09:00:00Z"), deferred: true },
    { id: "b", status: "waiting", joinedAt: at("2026-09-05T09:05:00Z") },
  ];
  const result = selectNextToCall(entries);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.next.id, "b");
    assert.deepEqual(result.steppedOver.map((e) => e.id), ["a"]);
  }
});

test("a deferred entry that is no longer deferred keeps its original place", () => {
  const entries: QueueEntry[] = [
    { id: "a", status: "waiting", joinedAt: at("2026-09-05T09:00:00Z"), deferred: false },
    { id: "b", status: "waiting", joinedAt: at("2026-09-05T09:05:00Z") },
  ];
  const result = selectNextToCall(entries);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.next.id, "a");
});

test("when every waiting entry is deferred the earliest is callable, not empty_queue", () => {
  const entries: QueueEntry[] = [
    { id: "a", status: "waiting", joinedAt: at("2026-09-05T09:00:00Z"), deferred: true },
    { id: "b", status: "waiting", joinedAt: at("2026-09-05T09:05:00Z"), deferred: true },
  ];
  const result = selectNextToCall(entries);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.next.id, "a");
});

test("a deferred entry never overtakes: provisional still steps over first", () => {
  const entries: QueueEntry[] = [
    { id: "p", status: "provisional", joinedAt: at("2026-09-05T08:00:00Z") },
    { id: "a", status: "waiting", joinedAt: at("2026-09-05T09:00:00Z"), deferred: true },
    { id: "b", status: "waiting", joinedAt: at("2026-09-05T09:05:00Z") },
  ];
  const result = selectNextToCall(entries);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.next.id, "b");
    assert.deepEqual(result.steppedOver.map((e) => e.id), ["p", "a"]);
  }
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm test`
Expected: FAIL. `CALL_RESPONSE_SECONDS` and `callDeadlinePassed` are not exported; the transition checks report `no transition called -> waiting on customer_not_ready`.

- [ ] **Step 3: Add the two transitions**

In `src/domain/index.ts`, extend the `Trigger` union with `"customer_not_ready"` and `"call_expiry"`, then add to `TRANSITIONS` immediately after the `undo_call` row:

```typescript
  // The call response window. Both are called -> waiting, both RETAIN joined_at,
  // and both are UNGATED: this is the automatic application of a rule the
  // customer was told in writing, not a human reversal of one (v4 3.5). They are
  // kept distinct from undo_call, and from each other, so the fairness log says
  // whether the customer declined or simply did not answer.
  { from: "called", to: "waiting", trigger: "customer_not_ready", requiresApprover: false },
  { from: "called", to: "waiting", trigger: "call_expiry", requiresApprover: false },
```

- [ ] **Step 4: Add the window constant and the deadline predicate**

```typescript
// The response window. DELIBERATELY NOT location.grace_seconds (300): grace is
// how long a counter waits for a body to arrive, this is how long we wait for a
// reply. Two different questions deserve two numbers.
export const CALL_RESPONSE_SECONDS = 120;

export function callDeadlinePassed(
  calledAt: Date,
  now: Date,
  windowSeconds: number = CALL_RESPONSE_SECONDS,
): boolean {
  return now.getTime() - calledAt.getTime() > windowSeconds * 1000;
}
```

- [ ] **Step 5: Make selection deferral-aware**

Add `readonly deferred?: boolean;` to `QueueEntry` with this comment, then replace the body of `selectNextToCall`:

```typescript
  // Deferral is DERIVED by the caller from the fairness log and passed in, so
  // this module stays pure and no deferral state is stored on the entry.
  // Absent means not deferred.
  readonly deferred?: boolean;
```

```typescript
export function selectNextToCall(entries: readonly QueueEntry[]): CallNextSelection {
  const inLine = [...entries]
    .filter((e) => e.status === "provisional" || e.status === "waiting")
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

  const steppedOver: QueueEntry[] = [];

  for (const entry of inLine) {
    if (entry.status === "waiting" && entry.deferred !== true) {
      return { ok: true, next: entry, steppedOver };
    }
    // provisional holds its place and is skipped. A deferred entry does the
    // same and for the same reason: it keeps joined_at and is simply not
    // callable yet. Both are REPORTED so the console can draw the detour.
    steppedOver.push(entry);
  }

  // EXHAUSTION. If the only thing standing between the counter and the queue is
  // deferral, the earliest deferred entry becomes callable. A customer cannot
  // lose a place to nobody, and a branch cannot deadlock its own line.
  const firstDeferred = inLine.find((e) => e.status === "waiting" && e.deferred === true);
  if (firstDeferred !== undefined) {
    return {
      ok: true,
      next: firstDeferred,
      steppedOver: steppedOver.filter((e) => e.id !== firstDeferred.id),
    };
  }

  return { ok: false, reason: "empty_queue", steppedOver };
}
```

- [ ] **Step 6: Run the tests and the boundary check**

Run: `pnpm test && npx tsc --noEmit && node scripts/boundary-check.ts`
Expected: all domain tests PASS, zero type errors, all boundary properties hold.

- [ ] **Step 7: Stage, do not commit**

```bash
git add src/domain/index.ts tests/domain.test.ts
```

Proposed message: `feat(domain): call response window, two deferral transitions, deferral-aware selection`

---

### Task 2: Read layer — derive `deferred` per entry

**Files:**
- Modify: `src/persistence/read/index.ts` (the `readQueue` query and `QueueRow` type)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime.
- Produces: `QueueRow` gains `readonly deferred: boolean`. `/api/board` entries carry `deferred`.

- [ ] **Step 1: Add the derivation to the queue query**

`readQueue` connects as `hms_ro`, SELECT only, so this is a read and nothing more. Add the column to the existing SELECT:

```sql
       (EXISTS (
          SELECT 1 FROM events d
           WHERE d.entry_id = e.id
             AND d.kind IN ('customer_not_ready', 'call_expiry')
             AND NOT EXISTS (
               SELECT 1 FROM events c
                WHERE c.location_id = e.location_id
                  AND c.kind IN ('call_next', 'out_of_order_call')
                  AND c.occurred_at > d.occurred_at)))
         AS deferred
```

Add `readonly deferred: boolean;` to the row type. Alias the entries table as `e` if it is not already aliased.

- [ ] **Step 2: Verify it against production data, read-only**

Run:

```bash
node --env-file=.env.railway .workflow/scratch/q.mjs ro "SELECT id, status, name, (EXISTS (SELECT 1 FROM events d WHERE d.entry_id = e.id AND d.kind IN ('customer_not_ready','call_expiry') AND NOT EXISTS (SELECT 1 FROM events c WHERE c.location_id = e.location_id AND c.kind IN ('call_next','out_of_order_call') AND c.occurred_at > d.occurred_at))) AS deferred FROM entries e WHERE status IN ('waiting','called') ORDER BY joined_at"
```

Expected: every row returns `deferred: false`. No deferral events exist yet, so anything else means the predicate is wrong.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Stage**

```bash
git add src/persistence/read/index.ts
```

---

### Task 3: Apply — `deferEntry` and `sweepCallDeadlines`

**Files:**
- Modify: `src/orchestrator/apply/index.ts`

**Interfaces:**
- Consumes: `callDeadlinePassed`, `CALL_RESPONSE_SECONDS` from Task 1.
- Produces:
  - `deferEntry(input: { entryId: string; locationId: string; trigger: "customer_not_ready" | "call_expiry"; actor?: string | null; transport?: Transport }): Promise<Applied<{ deferred: boolean }>>`
  - `sweepCallDeadlines(input: { locationId: string; transport: Transport }): Promise<Applied<{ deferredEntryIds: readonly string[] }>>`

- [ ] **Step 1: Implement `deferEntry`**

Follow the shape of `undoCall` (`src/orchestrator/apply/index.ts:601`) — take the queue lock, load the entry, call `applyStatusChange` with the given trigger. Then send the deferral message when a transport and a contact are both present. The message is verbatim spec section 5:

```typescript
const DEFERRED_TEXT =
  "No problem - we've moved you back one place. You keep your join time and we'll call you again shortly.";
```

The status change is CONDITIONAL on the entry still being `called`; `applyStatusChange` already refuses a transition whose `from` does not match, which is the race guard. A failed send is logged and does NOT undo the deferral, matching the rule already stated at `src/api/index.ts:672`.

- [ ] **Step 2: Implement `sweepCallDeadlines`**

```typescript
// LAZY EXPIRY. There is no scheduler in this codebase and this does not add
// one. The deadline is evaluated whenever someone looks at the branch, which in
// practice is the desk console's board poll.
//
// called_at is DERIVED from the fairness log, not stored: the occurred_at of
// the entry's most recent call event. No called_at column is added.
export async function sweepCallDeadlines(input: {
  readonly locationId: string;
  readonly transport: Transport;
}): Promise<Applied<{ readonly deferredEntryIds: readonly string[] }>> {
```

Query candidates, then defer each via `deferEntry` with trigger `call_expiry`:

```sql
SELECT e.id,
       (SELECT max(c.occurred_at) FROM events c
         WHERE c.entry_id = e.id
           AND c.kind IN ('call_next', 'out_of_order_call')) AS called_at
  FROM entries e
 WHERE e.location_id = $1 AND e.status = 'called'
```

Skip any row whose `called_at` is null — an entry called before this feature existed has no call event and must not be swept on a guess. Use `callDeadlinePassed(called_at, new Date())`.

- [ ] **Step 3: Write the failing proof, run it, watch it fail**

Defer the full proof to Task 8; here just confirm compilation and boundaries.

Run: `npx tsc --noEmit && node scripts/boundary-check.ts`
Expected: zero errors; CO-2 still passes because both functions live in `orchestrator/apply/`.

- [ ] **Step 4: Stage**

```bash
git add src/orchestrator/apply/index.ts
```

---

### Task 4: Outbound — call notification and completion line

**Files:**
- Modify: `src/orchestrator/apply/index.ts` (`callNext`, `completeService` callers)
- Modify: `src/api/index.ts:361-384` (call-next route), `:428-434` (complete verb)

**Interfaces:**
- Consumes: `Transport` from `src/tools/whatsapp/index.ts`.
- Produces: `notifyCalled(input: { entryId: string; counter: string | null; transport: Transport }): Promise<void>`; completion line sent before `sendSurvey`.

- [ ] **Step 1: Add the two message constants, verbatim from the spec**

```typescript
export const calledText = (name: string | null, counter: string | null): string =>
  `${name ?? "Hello"}, you're up at ${counter ?? "the counter"}. ` +
  `Reply READY within 2 minutes. Reply NO if you need more time and we'll move you back one place.`;

export const completeText = (name: string | null, counter: string | null): string =>
  `Thanks for coming in${name === null ? "" : `, ${name}`}. ` +
  `Your service at ${counter ?? "the counter"} is complete.`;
```

- [ ] **Step 2: Send on call**

In the `/api/call-next` route, after a successful `callNext` that returned a non-null `calledEntryId`, look up the entry's `contact` and `name` and send `calledText`. Send only when `contact` is non-null — a walk-in has no destination and must not produce a failed-send warning on every call.

- [ ] **Step 3: Send on complete**

At `src/api/index.ts:433`, send `completeText` immediately BEFORE `sendSurvey`, gated the same way on a non-null contact.

- [ ] **Step 4: Typecheck and boundary**

Run: `npx tsc --noEmit && node scripts/boundary-check.ts`
Expected: clean.

- [ ] **Step 5: Stage**

```bash
git add src/orchestrator/apply/index.ts src/api/index.ts
```

---

### Task 5: Inbound resolution — READY, and NO while called

**Files:**
- Modify: `src/tools/whatsapp/inbound.ts` (one keyword)
- Modify: `src/api/index.ts` (the intent branch, around `:602-668`)
- Test: `tests/inbound.test.ts`

**Interfaces:**
- Consumes: `deferEntry` from Task 3, `checkIn` from the existing apply surface.
- Produces: no new exports.

- [ ] **Step 1: Write the failing parser test**

Append to `tests/inbound.test.ts`:

```typescript
test("READY parses as affirmative, in any case, with punctuation", () => {
  for (const body of ["READY", "ready", "Ready!", " ready "]) {
    assert.deepEqual(parseInbound(body), { kind: "affirmative" });
  }
});

test("NO still parses as negative and is not swallowed by the name branch", () => {
  assert.deepEqual(parseInbound("no"), { kind: "negative" });
  assert.deepEqual(parseInbound("Nope"), { kind: "negative" });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test`
Expected: FAIL — `ready` currently returns `{ kind: "unknown", text: "READY" }`.

- [ ] **Step 3: Add the keyword**

In `src/tools/whatsapp/inbound.ts`, extend `YES`:

```typescript
const YES = ["yes", "y", "yeah", "yep", "confirm", "confirmed", "ok", "okay", "1", "ready"];
```

The intent set is unchanged and the ambiguity rule is untouched; `ready` is unambiguous in every state.

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Resolve both intents against the `called` state**

In `src/api/index.ts`, inside the non-survey branch, ABOVE the existing `provisional` confirm branch:

```typescript
      } else if (intent.kind === "affirmative" && existing?.status === "called") {
        // READY. The customer is at the counter; this is the same check-in the
        // desk performs, arrived at from the other end of the conversation.
        const arrived = await checkIn({ entryId: existing.id, locationId, actor: "customer" });
        reply = arrived.ok
          ? "Thank you - please go to the counter now."
          : "We could not check you in just now. Please ask at reception.";
      } else if (intent.kind === "negative" && existing?.status === "called") {
        const moved = await deferEntry({
          entryId: existing.id,
          locationId,
          trigger: "customer_not_ready",
          actor: "customer",
        });
        reply = moved.ok
          ? DEFERRED_TEXT
          : "We could not move your place just now. Please ask at reception.";
      }
```

Precedence matters: the survey branch stays first, so a served customer's YES/NO still answers the survey. These two sit above the `provisional` branch, and both require `status === "called"`, so nothing else changes shape.

`deferEntry` is called WITHOUT a transport here because the reply itself carries `DEFERRED_TEXT` — sending twice would message the customer two identical lines.

- [ ] **Step 6: Typecheck, test, boundary**

Run: `pnpm test && npx tsc --noEmit && node scripts/boundary-check.ts`
Expected: clean.

- [ ] **Step 7: Stage**

```bash
git add src/tools/whatsapp/inbound.ts src/api/index.ts tests/inbound.test.ts
```

---

### Task 6: Named join — two steps, name gate, position and window copy

**Files:**
- Modify: `src/api/index.ts` (join, name-capture and confirm branches)

**Interfaces:**
- Consumes: `estimateWaitFor`, `renderEstimate`, `recordEntryName`, `confirmEntry`.
- Produces: `positionOf(locationId, entryId): Promise<number>` — the count of `waiting` entries strictly ahead by `joined_at`, plus one.

- [ ] **Step 1: Add the position helper**

A count, not an estimate, so it is exact and R-G does not apply to it:

```typescript
async function positionOf(locationId: string, entryId: string): Promise<number> {
  const queue = await readQueue(locationId);
  const target = queue.find((e) => e.id === entryId);
  if (target === undefined) return 0;
  const ahead = queue.filter(
    (e) => e.status === "waiting" && e.joinedAt < target.joinedAt,
  ).length;
  return ahead + 1;
}
```

- [ ] **Step 2: Replace the join reply so it asks for the name only**

```typescript
        reply = joined.ok
          ? "Before we hold your place, what name should we put it under? " +
            "Please use the name on the ID you'll present at the counter."
          : "We could not add you to the queue just now. Please ask at reception.";
```

The estimate is still computed and stored BEFORE the join, unchanged, so the stored prediction remains the one this customer was given. It is simply not quoted until the name lands.

- [ ] **Step 3: Make the name reply carry position and wait**

In the existing name-capture branch:

```typescript
        if (named.ok) {
          const pos = await positionOf(locationId, existing.id);
          const est = await estimateWaitFor({ locationId, aheadInQueue: Math.max(0, pos - 1) });
          reply =
            `Thanks, ${intent.text}. You're ${String(pos)} in line. ${renderEstimate(est)} ` +
            `Reply YES to confirm and hold your place.`;
        } else {
          reply = "Reply JOIN to take a place in line, YES to confirm, or LEAVE to give up your place.";
        }
```

- [ ] **Step 4: Gate confirm on the name, and carry the window warning**

Replace the `provisional` confirm branch:

```typescript
      } else if (intent.kind === "affirmative" && existing?.status === "provisional") {
        if (existing.name === null) {
          // The name is the gate. Confirming an unnamed entry is what produced a
          // board showing a bare phone number, which is a privacy defect on any
          // screen a stranger can see.
          reply =
            "Before we confirm, what name should we put this under? " +
            "Please use the name on the ID you'll present at the counter.";
        } else {
          const confirmed = await confirmEntry({ entryId: existing.id, locationId, actor: "customer" });
          if (confirmed.ok) {
            const pos = await positionOf(locationId, existing.id);
            const est = await estimateWaitFor({ locationId, aheadInQueue: Math.max(0, pos - 1) });
            reply =
              `Confirmed, ${existing.name}. You're ${String(pos)} in line. ${renderEstimate(est)} ` +
              `When we call you, you have 2 minutes to reply READY, or NO if you need more time - ` +
              `then you move back one place, keeping your join time.`;
          } else {
            reply = "We could not confirm just now. Please ask at reception.";
          }
        }
```

- [ ] **Step 5: Wire the sweep into the two read points**

In `GET /api/board`, before the `Promise.all`:

```typescript
    // Lazy expiry, before the read, so the board a human sees already reflects
    // any deadline that has passed rather than showing a stale 'called'.
    await sweepCallDeadlines({ locationId, transport: outboundTransport() });
```

Do the same at the top of `POST /api/call-next`, before `callNext`.

- [ ] **Step 6: Typecheck, test, boundary**

Run: `pnpm test && npx tsc --noEmit && node scripts/boundary-check.ts`
Expected: clean.

- [ ] **Step 7: Stage**

```bash
git add src/api/index.ts
```

---

### Task 7: Console — render the deferred entry

**Files:**
- Modify: `web/console/index.html` (`entryRow`, near `:1532`, and the board mapper near `:1208`)

- [ ] **Step 1: Carry the flag through the mapper**

Where the board response is mapped to entries (near `:1208`, beside `contact: row.contact || null`), add `deferred: !!row.deferred,`.

- [ ] **Step 2: Render it on the existing detour rail**

In `entryRow`, treat a deferred entry the way `steppedOver` is already treated — reuse `DETOUR` and the `is-stepped` class — and add the note:

```javascript
  const deferNote = e.deferred
    ? '<div class="note">Moved back one place. Keeps their join time.</div>'
    : "";
```

No new visual language is invented, per spec section 7.

- [ ] **Step 3: Rebuild the console and typecheck**

Run: `node scripts/build-console.mjs && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Stage**

```bash
git add web/console/index.html
```

---

### Task 8: The live proof, with a break-first RED

**Files:**
- Create: `scripts/d1-call-response-proof.ts`
- Modify: `package.json` (add `"d1"` script), `scripts/boundary-core.ts` (permit the writer, with justification)

- [ ] **Step 1: Write the proof**

Against a fixture location created as `hms_ddl`, driven through the governed write and the real routes, observing the QUEUE and the LOG rather than return values:

1. Seed three waiting entries, one with a contact.
2. `callNext` → assert the earliest is `called`, assert a `call_next` event exists, assert the simulated transport holds the call notification.
3. Send `NO` through the inbound path → assert status is `waiting`, assert `joined_at` is UNCHANGED (byte-compare to the value read before), assert a `customer_not_ready` event exists.
4. `callNext` again → assert the SECOND person is called, and the deferred one was reported in `steppedOver`.
5. `callNext` a third time → assert the deferred entry is now callable again and is called, still at its original `joined_at`.
6. Silence path: call someone, backdate their `call_next` event by 3 minutes as `hms_ddl`, run `sweepCallDeadlines`, assert they are `waiting` with a `call_expiry` event.
7. Exhaustion: defer every waiting entry, assert `callNext` still calls the earliest rather than returning `empty_queue`.

- [ ] **Step 2: BREAK-FIRST. Remove the skip clause and watch RED**

Temporarily change `selectNextToCall`'s guard from `entry.deferred !== true` back to omitting the deferral check. Run `pnpm d1`. Expected: step 4 FAILS, because the deferred entry is called again instead of the second person.

**Record the RED output.** Per break-first discipline, no part of this is written as "fixed" until this failure has been personally observed.

- [ ] **Step 3: Restore and watch GREEN**

Restore the guard. Run `pnpm d1`. Expected: all steps PASS.

- [ ] **Step 4: Full regression**

Run: `for p in b1 b2 b3 b3i b4 b5 b6 c0 c1 c2 c3 c4 c5 c6 p1 p2 p3 d1; do out=$(pnpm $p 2>&1); echo "$p exit=$?"; done`
Expected: every one `exit=0`. B3 and C2 are the likely movers because the confirm path changed; if either fails, the confirm-path change is wrong, not the proof.

- [ ] **Step 5: Stage and report**

```bash
git add scripts/d1-call-response-proof.ts package.json scripts/boundary-core.ts
git status --porcelain
```

STOP HERE. Deploy to Railway is a separately gated surface and needs King B's explicit go, as does the commit.

---

## Self-Review

**Spec coverage:** §1 deferral derivation → Tasks 1, 2. §2 transitions → Task 1. §3 deadline and sweep → Tasks 1, 3, 6 step 5. §4 named join → Task 6. §5 message set → Tasks 3, 4, 5, 6. §6 intent resolution → Task 5. §7 console → Task 7. §8 testing → Tasks 1, 5, 8. §9 risks → carried into the Task 8 stop.

**Type consistency:** `deferred` is the property name in `QueueEntry` (Task 1), the SQL alias (Task 2), the board payload and the console mapper (Task 7). `deferEntry` and `sweepCallDeadlines` keep their Task 3 signatures at every call site in Tasks 5 and 6. `DEFERRED_TEXT` is defined once in Task 3 and reused in Task 5.

**Known gap, accepted deliberately:** `QueueEntry.deferred` is optional, so a caller that forgets to populate it silently gets no deferral. Making it required would break the existing proof scripts that construct `QueueEntry` values. The mitigation is Task 8 step 2 — the break-first RED observes the real behaviour end to end, which a forgotten wire-up would fail.

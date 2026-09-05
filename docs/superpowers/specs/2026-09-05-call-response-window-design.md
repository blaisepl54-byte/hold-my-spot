# The call response window, deferral, and named join

Design, 2026-09-05. Commissioned by King B after a live demo run exposed four gaps.
Approved in chat before writing; nothing here is implemented yet.

## The four gaps, as observed

1. **Calling a customer notifies nobody.** `call_next` changes status and writes an
   event. No message leaves the building. The customer learns they were called by
   watching the board, which is the thing this product exists to replace.
2. **There is no way to say "not yet".** A called customer who is in the car park has
   one outcome available to them: no-show.
3. **Completing a service sends only the survey.** `complete` calls `sendSurvey`
   (`src/api/index.ts:433`); there is no "your service is done" line before it.
4. **The join reply asks for two things and gets one.** It says *"Reply YES to confirm
   and hold your place, and reply with your name"*. Only one message can be first,
   the customer sends YES because that is what they were told to do first, and
   `name` stays NULL. The console then renders the raw phone number
   (`web/console/index.html:1536`, observed visible), which is a privacy defect on any
   screen a stranger can see.

## Decisions taken, and by whom

| Question | Ruling | Ruled by |
|---|---|---|
| What "bumped down" does to position | **Defer, do not reorder.** `joined_at` is never written. | King B, 2026-09-05 |
| Silence for 2 minutes | **Treated as "not ready".** Deferred, lazily evaluated. | King B, 2026-09-05 |
| How long a deferral lasts | **Until one more person is called.** Exactly one place, never more. | King B, 2026-09-05 |
| When it ships | **Before the submission video.** | King B, 2026-09-05 |

## What this design does NOT change

Stated first, because these are the constraints that shaped every choice below.

- **I1 stands, untouched.** Order is `joined_at`. It is not written by this feature,
  by anything, on any path. `hms_rw` cannot write it (migration 002) and that stays true.
- **No new sort key.** `selectNextToCall`'s comment — *"Position is DERIVED here, never
  stored, so there is no priority field to corrupt and no reordering API to misuse"* —
  survives this feature intact.
- **No migration. No schema change. No grant change.** Established below.
- **The seven statuses stay seven.** Deferral is not a status.
- **R-G stands.** Every customer-facing wait figure is a range from `renderEstimate`,
  or the honest refusal. No point value is introduced.

## 1. Deferral is derived, not stored

A deferred entry is `waiting` — it never left the line — and is temporarily not
callable. The state lives in the fairness log, which already exists, is append-only,
and which `hms_rw` may INSERT into.

**The rule.** An entry is deferred when its most recent deferral event has no
`call_next` or `out_of_order_call` at that location recorded after it.

```
deferred(e) :=
  EXISTS d IN events WHERE d.entry_id = e.id
                       AND d.kind IN ('customer_not_ready', 'call_expiry')
  AND NOT EXISTS c IN events WHERE c.location_id = e.location_id
                               AND c.kind IN ('call_next', 'out_of_order_call')
                               AND c.occurred_at > d.occurred_at
```

**Why the log can carry this.** Verified against production, not assumed: `events`
holds 14 real `call_next` rows with `occurred_at`, written by the governed write path
under actor identities. `kind` is free text and `hms_rw` holds INSERT on `events`
(migration 002 retained it deliberately: append-only means insert-yes, alter-no).

**Consequence: no migration.** `entries` gains no column, so no grant is retrofitted,
so nothing in the B2 rejection proof moves. This is the single largest risk reduction
available and it is why the derivation was preferred over a `deferred_until` column.

**The exhaustion case.** If every waiting entry is deferred, the earliest of them
becomes callable. A customer cannot lose a place to nobody, and the branch cannot
deadlock itself into an uncallable queue.

## 2. Two new transitions

Added to `TRANSITIONS` in `src/domain/index.ts`. Both `called → waiting`, both ungated,
both retaining `joined_at`.

| from | to | trigger | approver |
|---|---|---|---|
| `called` | `waiting` | `customer_not_ready` | no |
| `called` | `waiting` | `call_expiry` | no |

Ungated is correct under the v4 3.5 gating principle: this is the automatic
application of a published rule the customer was told about in writing, not a human
reversal of one. `undo_call` already occupies this same edge for the staff-initiated
case; these two are the customer-initiated and time-initiated cases, kept distinct so
the log says which happened.

`grace_expiry` remains in the table and remains fired by nothing. **That pre-existing
defect is reported, not fixed here** — wiring it is a separate ruling about no-show
policy, and folding it into this change would hide it.

## 3. The deadline, and what fires it

**`CALL_RESPONSE_SECONDS = 120`**, a domain constant. Deliberately NOT
`location.grace_seconds` (300): grace is how long a counter waits for a body to
arrive; this is how long we wait for a reply. Two different questions, two numbers.

**Called-at is derived**, like deferral: the `occurred_at` of the entry's latest
`call_next` / `out_of_order_call` event. No `called_at` column is added.

**Evaluation is lazy.** There is no scheduler in this codebase and this feature does
not add one. A named operation `sweepCallDeadlines({ locationId, transport })` lives
in `src/orchestrator/apply/` — the only directory permitted to write `entries`
(CO-2) — and is invoked at exactly two points:

- `GET /api/board`, before the queue is read. The desk console polls this, so an open
  console fires the sweep within its poll interval.
- `POST /api/call-next`, before selection.

**Race safety follows X9a's precedent**: the write is conditional,
`WHERE id = $1 AND status = 'called'`, so a check-in that lands in the same instant
wins and the sweep becomes a no-op rather than clobbering it.

**The honest limit, stated rather than buried:** if no console is open and no staff
action occurs, the deferral message is sent when someone next looks. The customer's
place is unaffected either way — they are only ever moved back one slot, and only
when someone else is actually called.

## 4. Name and ID capture becomes the join gate

The join conversation becomes two steps. The name stops competing with the
confirmation for the same reply slot, which is what made it lose.

```
customer: JOIN
   -> Before we hold your place, what name should we put it under?
      Please use the name on the ID you'll present at the counter.

customer: Marcia Bennett
   -> Thanks, Marcia Bennett. You're 3rd in line, about 12 to 15 minutes.
      Reply YES to confirm and hold your place.

customer: YES
   -> Confirmed, Marcia Bennett. You're 3rd in line, about 12 to 15 minutes.
      When we call you, you have 2 minutes to reply READY, or NO if you need
      more time - then you move back one place, keeping your join time.
```

**Name becomes mandatory before `provisional → waiting`, on the WhatsApp channel
only.** A YES arriving with `name IS NULL` is answered by re-asking for the name; it
does not confirm. This is a behaviour change to the confirm path and is the reason the
C2/B3 proofs must be re-run rather than assumed.

`qr` and `reception` entries are untouched by this rule. X8 has them enter at
`waiting`, already confirmed, because presence is proof — they never pass through
`provisional`, so there is no confirm step to gate. A walk-in with no name stays
legal, and the console's existing fallback covers it.

**The ID sentence is product copy, not enforcement.** Nothing in this system checks
identity, and the message must not imply that it does. It sets an expectation for the
counter, which is where identity is actually checked by a human.

**Privacy consequence.** The window in which the console renders a bare phone number
shrinks to the seconds between JOIN and the name reply, instead of lasting the whole
visit. The underlying fallback at `web/console/index.html:1536` is unchanged and
remains a separate finding.

## 5. The message set

Every customer-facing wait figure comes from `renderEstimate` and is a range.
`{N}` is the count of `waiting` entries ahead by `joined_at`, a count and not an
estimate, so it is exact.

| Trigger | Message |
|---|---|
| `JOIN`, name is null | Before we hold your place, what name should we put it under? Please use the name on the ID you'll present at the counter. |
| Name recorded | Thanks, {name}. You're {N} in line, about {low} to {high} minutes. Reply YES to confirm and hold your place. |
| `YES`, name present | Confirmed, {name}. You're {N} in line, about {low} to {high} minutes. When we call you, you have 2 minutes to reply READY, or NO if you need more time - then you move back one place, keeping your join time. |
| `YES`, name null | Before we confirm, what name should we put this under? Please use the name on the ID you'll present at the counter. |
| Called **(new, business-initiated)** | {name}, you're up at {counter}. Reply READY within 2 minutes. Reply NO if you need more time and we'll move you back one place. |
| Deferred, either cause **(new)** | No problem - we've moved you back one place. You keep your join time and we'll call you again shortly. |
| Service complete **(new line, sent before the existing survey)** | Thanks for coming in, {name}. Your service at {counter} is complete. |

## 6. Intent resolution

**The parser's intent set is not modified.** `parseInbound` already returns `negative`
(`src/tools/whatsapp/inbound.ts:22`, `NO = ["no","n","nope","2"]`); only the
orchestrator's resolution of it is missing. This design adds resolution, in keeping
with the parser header's own rule that ambiguity is resolved against state by the
layer that holds the entry. The parser's single change is one added keyword, below;
no new intent kind, and the ambiguity rule is untouched.

Precedence, highest first. Survey stays first exactly as today.

| Entry state | `YES` / affirmative | `NO` / negative |
|---|---|---|
| survey open | survey answer 1 | survey answer 1 |
| `called` | READY - check in, begin serving | not ready - defer |
| `provisional`, named | confirm | (unhandled: re-prompt) |
| `provisional`, unnamed | re-ask for name | (unhandled: re-prompt) |

`READY` is added to the `YES` keyword list. It is unambiguous in every state and
collides with nothing.

## 7. Console

`GET /api/board` gains a per-entry `deferred` boolean, derived as in section 1. The
console renders a deferred entry on the existing detour rail — the same treatment
`steppedOver` already receives — with the note "moved back one place, keeps their
join time". No new visual language is invented.

## 8. Testing

TDD throughout: the failing test comes first, is watched fail, then the implementation.

**Pure unit tests** (`tests/`, node:test, no database):
- `selectNextToCall` skips a deferred entry and returns the next one.
- A deferred entry becomes callable once a later call event exists.
- All-deferred: the earliest deferred entry is returned, not `empty_queue`.
- `checkTransition` accepts both new triggers and still rejects everything absent.
- Deadline arithmetic at the boundary: 119s not expired, 121s expired.

**Proof scripts**, following the existing house pattern, run against a live database:
- `d1-call-response-proof.ts`: the full round trip. Call, notify, NO, defer, next
  person called, first person callable again, all observed from the log and the
  queue rather than from return values.
- Break-first on the deferral skip: re-introduce the missing skip clause, watch the
  next-called assertion go RED, restore, watch GREEN. No fix is recorded as fixed
  until that RED has been personally observed.

**Regression, non-negotiable:** `b1 b2 b3 b3i b4 b5 b6 c0 c1 c2 c3 c4 c5 c6 p1 p2 p3`
must all still exit 0. B3 and C2 are the ones most likely to move, because the confirm
path changes shape.

## 9. Risks

- **Business-initiated messaging.** The call notification is not a reply. In the
  Twilio sandbox this is fine and the customer's session will be open anyway. On a
  production WABA it requires a pre-approved template, which is a Meta process and not
  code. `docs/HoldMySpot_WhatsApp_Integration_Path.md:57` anticipated exactly this.
- **The demo flow changes shape.** The two-step join adds a message round trip on
  camera. Rehearsal must be redone before recording.
- **A write inside a GET.** `/api/board` becomes capable of changing state. This is
  the standard lazy-expiry pattern and the write is conditional, but it is unusual
  and is called out so a reviewer meets it deliberately rather than discovers it.
- **Deploy is a gated surface.** Shipping this to Railway needs King B's explicit go,
  separately from approving this design.

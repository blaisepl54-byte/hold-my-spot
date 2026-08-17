# HMS BUILD ORDER 3, MEASUREMENT LAYER AND DEPLOYMENT

**Realm:** holdmyspot
**From:** Claude, architect-coordinator
**Sealed by:** King B, pending
**Authored:** 2026-08-17
**Intended path:** `docs/governance/BUILD_ORDER_3.md`
**Predecessor:** `BUILD_ORDER_2.md`, `sha256:0d0980a23e9ce23d635322922359a461fa220a0ca626e0057d464989aff171a8`

Build Order 2 is COMPLETE, including its deferred set, which was closed 2026-08-16. This order does
not revise it. Every guarantee it established stands unchanged, and no change in this order may
weaken one.

---

## 0. Standing position

**Everything in this order is ADDITIVE.** New tables, new columns, new modules. No change to the
behavior of `entries` or `events`, no change to the status set, no change to the grants proven in
B2. The B0 through B6 proofs must continue to pass unmodified at every stage. **If a step in this
order requires weakening an existing guarantee, stop and report rather than weakening it.**

**Agent purity is preserved without exception.** Every agent introduced here is a pure function that
takes a snapshot and returns a proposal. Agents never import tools, never open a connection, and
never decide. The orchestrator gathers input, calls the agent, and applies the result. This is the
guarantee that replaced MCP and it is not relaxed for convenience.

**Write discipline unchanged.** Create, modify and stage freely. Do not commit. Do not push. Commit
and push are separate surfaces and one authorization never cascades to the other.

**R9 is resolved rather than excepted.** King B ruled 2026-08-17 that deployment becomes **Phase
5**, sequenced after this order lands. R9 stands unamended and nothing deploys inside Build Order 3.
Deployment, authentication and hosting are Phase 5 scope and are previewed in section 4 only so that
this order does not build something Phase 5 must tear out.

**Still open for Phase 5, disclosed here so it is decided knowingly rather than discovered.**
Connecting Netlify and Railway to the repository grants those vendors read access to full history,
which permanently contains real contact data and names the IP holding company. The repository does
not become public and G-1 is not breached. The exposure is vendor-side. King B accepts or directs an
alternative before Phase 5 begins.

---

## 1. Rulings carried into this order

King B, 2026-08-17, relayed in session.

**R-E. Build the measurement layer in full**, not the reduced version proposed. Output is a branch
dashboard report.

**R-F. All performance measurement is tracked BY COUNTER, not by named staff.** No employee is named
in any table, any report, or any output of this order. This is accepted with the architect's
pushback intact: measurement is displayed with sample size and spread visible, nothing is ranked,
and no routing decision is ever taken automatically from it. The Adherence Agent's posture, which is
to report drift without acting, governs here too.

**R-G. Customer-facing estimates are shown as a range, never a point value, and only after the
sample gate passes.** Where the gate fails, the honest string is emitted and no estimate is
invented. This is the hard rule already in force and it is restated because this order is the first
place it can be violated.

**R-H. The survey is two questions.** Response rate over WhatsApp collapses past two taps.

**R-I. Service types are DATA, not schema.** Seeded per branch, replaceable without a migration.
King B has not yet ruled the real category list and rung 2 interviews are what settle it. The demo
seed is explicitly provisional and must be labelled as such wherever it appears.

---

## 2. The dependency, stated once

Nothing in this order works without the recording. The system today records that an entry was
served. It does not record what the visit was for, which counter served it, how long service took,
or whether the customer got what they came for.

```
C0 counters and service types      the identities that everything else keys on
C1 the service record              what, where, how long
C2 the survey                      did it work, did the wait match
C3 the wait time agent             reads C1
C4 the dashboard                   reads C1 and C2
```

Build in that order. Each stage is independently demoable and each leaves the demo moment intact.

---

## 3. The measurement layer

### C0. Counters and service types. Migration 005.

**Counters become real.** A counter is currently a text label on the entry, flagged as an open item
in migration 004. That is now forced: a service cannot be attributed to where it happened when the
location is a string typed into a form.

```sql
counters
  id, location_id -> locations
  label            text NOT NULL
  active           boolean NOT NULL DEFAULT true
  UNIQUE (location_id, label)
```

No staff table. No person is modelled. Per R-F.

```sql
service_types
  id, location_id -> locations
  code             text NOT NULL
  label            text NOT NULL
  active           boolean NOT NULL DEFAULT true
  sort_order       integer NOT NULL DEFAULT 0
  UNIQUE (location_id, code)
```

**Seeded per branch, provisional.** Suggested demo seed: account services, deposit or withdrawal,
card services, general enquiry. **These are placeholders and are labelled as placeholders in the
seed script and in the dashboard footer.** The real list comes from branch operators.

`entries` gains `service_type_id` nullable referencing `service_types`, and `counter_id` nullable
referencing `counters`. Both nullable, because entries created before this migration have neither
and backfilling invented values would be fabrication.

**The existing `counter` label column is retained and not dropped.** Dropping it would break the
B6 proof. It becomes derived display only, and migration 005 backfills `counter_id` from it where an
exact label match exists, reporting the count matched and the count unmatched rather than assuming
completeness.

**Grants.** `hms_rw` gets SELECT and INSERT and UPDATE on both new tables, no DELETE. `hms_ro` gets
SELECT. `entries.joined_at` grants are untouched and the B2 rejection proof must still pass.

**Property.** Migration applies, second run is a no-op, the backfill reports matched and unmatched
counts, and `npm run b2` still passes unchanged.

### C1. The service record. Migration 006.

Service duration is currently unknowable because nothing records when service began or ended.

`entries` gains:

```sql
serving_started_at    timestamptz NULL
serving_ended_at      timestamptz NULL
```

Both written by the governed write function in `orchestrator/apply`, in the same transaction as the
status change and its fairness event, exactly as every other entry write. No second write path.

**Do not create a separate service_records table.** The entry is the service record. A second table
would be a second thing to keep consistent with the first.

**Property.** A full lifecycle produces a non-null `serving_started_at` on transition into serving
and a non-null `serving_ended_at` on transition out. Duration is derived, never stored. Every write
still emits its fairness event and the CO-2 claim is unchanged.

### C2. The survey. Migration 007.

```sql
surveys
  id, entry_id -> entries UNIQUE
  sent_at            timestamptz NOT NULL
  responded_at       timestamptz NULL
  achieved           boolean NULL
  wait_match         text NULL CHECK (wait_match IN ('shorter','as_expected','longer'))
```

Two questions, per R-H. Did you get what you came for, yes or no. How was the wait, shorter than
expected, about right, or longer than expected.

**The second question is not decoration.** It is the calibration signal that tells the wait time
agent whether its own estimates are landing, and it is the only feedback loop in the system that
closes between what was promised and what was experienced.

Sent through the existing transport interface after transition out of serving. The simulated surface
carries it identically to the Twilio path, so the survey demos with or without Twilio.

**A survey response is NOT a fairness event and does not write to `events`.** The fairness log
records changes to place in line. Conflating satisfaction data with the audit trail would weaken the
one artifact whose meaning is currently exact.

**Grants.** `hms_rw` SELECT, INSERT, UPDATE on `surveys`, no DELETE. `hms_ro` SELECT.

### C3. The wait time agent.

Pure function. Input is a snapshot. Output is a proposal. It opens nothing and decides nothing.

```
estimateWait(snapshot) -> { kind: 'estimate', lowMinutes, highMinutes, basis, sampleSize }
                        | { kind: 'no_estimate', reason }
```

**Two-pass sample-gated backoff.** Try each bucket in order and take the first that clears the
minimum sample gate:

```
1. service_type + counter + hour_of_day
2. service_type + location
3. location
4. no estimate
```

Minimum sample per bucket: 5 completed services. Below that, fall through. If all fall through,
return `no_estimate` and the caller emits the honest string. **The agent never extrapolates from a
sample below the gate and never returns a point value.**

Output is a range derived from the observed distribution, not a mean plus a guess. Use the
interquartile span of observed durations for the bucket, plus the count of entries ahead in queue
multiplied by the bucket median.

**`basis` and `sampleSize` are returned with every estimate** so the console and the dashboard can
show what the number rests on. An estimate whose provenance is invisible is a number people trust
more than they should.

**Customer-facing rendering, per R-G:** a range, never a point, and the honest string where the gate
fails. Shown in the WhatsApp join confirmation and on the console queue row.

**Seeding.** `src/synthetic/` generates plausible service history as pure values and `scripts/seed.ts`
writes them, matching the ratified split exactly. No new write path. Without seeded history the
agent correctly returns `no_estimate` for every request on day one, which is correct behavior and a
poor demo. **The demo states out loud that history is seeded.**

### C4. The branch dashboard.

Read-only, served to the console, reading as `hms_ro`. It writes nothing.

Per counter, over a selectable window:

- Services completed, and median service duration with interquartile spread
- Median duration by service type, so a counter handling harder work is visible as such
- Solve rate, the proportion of surveys answering yes, **with the response count and the sent count
  both shown**
- Wait expectation match, the three-way split
- Estimate calibration: predicted range against observed duration, which is how you learn whether
  the agent is any good

Per service type, across the branch:

- Volume, median duration, which counters it routed to and in what proportion
- Solve rate with sample size

**Constraints on the dashboard, from R-F, and these are requirements rather than preferences:**

- **No ranking.** No sort by performance, no leaderboard, no best or worst.
- **Sample size is displayed beside every rate.** A rate without its denominator is a rumour.
- **Where sample size is below 10, the figure is shown as provisional** and the dashboard says so.
- **No automatic routing** is taken from any of this. Routing proposals may be displayed; a human
  acts or does not.
- **No employee name appears anywhere.**
- **The service type list is footnoted as provisional** until rung 2 replaces it.

Output is a dashboard view in the console and an exportable report for the branch.

**Built as a client of JSON endpoints, rendered client side.** Not server-rendered HTML. This is the
single decision that makes Phase 5 a deploy rather than a rewrite, and it costs nothing now.

### C5. Adherence, extended.

The Adherence Agent already measures whether staff serve off the queue. With `counter_id` and
service duration recorded, it can now report drift per counter. **Reports, does not act.** Unchanged
posture, wider input.

---

## 4. Access control now, deployment in Phase 5

### C6. Bind to loopback by default. Build this inside Build Order 3.

The console binds to `0.0.0.0` with no authentication on any route. On a laptop that is a wifi
exposure: anyone on the same network can close the queue, remove entries, and call customers.

- **`HOST` env var, defaulting to `127.0.0.1`.** Set explicitly to `0.0.0.0` for the duration of a
  two-sided demo where a phone must reach the console over wifi. Default safe, opt in to exposure.

**No shared-secret token is built.** Clerk supersedes it in Phase 5 and building an auth mechanism
twice is throwaway work. Until Phase 5, the exposure is bounded by the loopback default and by the
fact that nothing is deployed.

**Property.** Default start is not reachable from another host on the network, proven by an observed
connection refusal from a second device or interface rather than by reading the bind call. With
`HOST=0.0.0.0` it is reachable. The B6 proof passes under both settings.

### Phase 5 preview, NOT built here

Named so that Build Order 3 does not paint into a corner. Nothing in this subsection is implemented
under this order.

- **Clerk** for authentication, gating the staff console. Customer confirm routes stay scoped by the
  entry's own token and do not require a login, because a customer holding a place in line must
  never be asked to create an account.
- **Railway** for the API and a managed PostgreSQL instance. **The three-role model is recreated
  there and King B creates those roles and supplies three connection URLs. Claude Code never holds
  the Railway superuser credential.** The rule does not relax because the database is remote. The B1
  and B2 rejection proofs are re-run against Railway, because a guarantee proven on a laptop is not
  proven in production and the fairness guarantee is the product.
- **Netlify** for the console as a static client of the Railway API.
- **Twilio** remains separately gated on explicit authorization, since it reaches real phones and
  cannot be undone. The simulated surface stays a first-class path capable of carrying the entire
  demo alone.

**Three things Build Order 3 does now so Phase 5 is a deploy rather than a rewrite:**

1. **The dashboard and console read JSON endpoints and render client side.** Do not server-render
   the dashboard as HTML. A server-rendered page has to be rebuilt to sit on Netlify; a client of an
   API only changes its base URL.
2. **API base URL comes from env, never hardcoded**, with the local default unchanged.
3. **No new secret is introduced into any tracked file.** `.env.example` documents any new contract
   with placeholders.

### Authenticated actor, and the line it must not cross

Phase 5's authentication is not only a gate. The fairness log currently records `actor` as a string
the console supplies, which is attributable by convention and correctly tiered as such under R13.
Clerk makes the actor an authenticated identity, which moves attribution from convention to checked.
For a pilot with a real branch that is the difference between an audit trail and a note.

**The line, ruled here so it is not discovered later.** Authenticated identity in the fairness log
is **audit attribution** and is legitimate. Joining that identity to performance metrics is
**scoring** and is forbidden under R-F. Same data, two purposes, one permitted. The dashboard stays
keyed on counter even after users exist, and no Phase 5 work may join a user identity to a
performance figure.

---

## 5. What must not regress

At every stage, before reporting:

```
npm run typecheck
npm run test
npm run b1 .. b6
```

All pass, unmodified. **The demo moment is the acceptance criterion for this order as a whole**, as
it was for the last one. If any step breaks it, that step is wrong.

`docs/hold-my-spot-prototype.html` stays unmodified and its pin assertion keeps passing. It remains
the fallback submission.

---

## 6. If the window closes early

Stated now rather than discovered at the deadline. The cut line, in order of what is given up last:

1. The demo moment and the fairness guarantee. **Never cut.**
2. C0 and C1, the recording. Cheap, and everything else is unreachable without it.
3. C6, the loopback default. One env var, closes a live exposure.
4. C3, the wait time estimate. The feature a customer actually feels.
5. C4, the dashboard. The deliverable King B ruled for.
6. C2, the survey.
7. C5, extended adherence.

**Phase 5 is not on this list.** It begins when Build Order 3 lands and is cut whole rather than
partially. A complete local build with a working demo beats a partial deployed one, and a
half-migrated deployment that breaks the demo is the worst outcome available.

---

## 7. Reporting

Report at staged, per section, stating the property proven and the instrument chosen. The
implementer selects the instrument; this order states the property. Protected words require
break-restore proof, observed RED before anything is called fixed. Post checks run after authoring,
mechanically, never asserted in advance. ABSENT, UNRESOLVED and UNSATISFIABLE remain honest answers.

**If a constraint in this order forbids its own required outcome, say so and stop rather than
working around it.** That has happened five times in this realm and three of those were the
architect's. Reporting it is correct behavior and is why they were fixed rather than shipped.

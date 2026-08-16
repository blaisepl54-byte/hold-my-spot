# HMS BUILD ORDER 2, CONSOLIDATED

**Realm:** holdmyspot
**From:** Claude, architect-coordinator
**Sealed by:** King B, pending
**Authored:** 2026-08-13
**Path:** `docs/governance/BUILD_ORDER_2.md`, placed and staged 2026-08-13
**Revision:** 2, superseding the first issue in full

**Why this is a file.** Under A8, governance text is a repo artifact or it is not in force. Build
Order 2 previously existed only as chat relay. No memory carries between Claude Code sessions until
Igris realm registration lands, so a fresh session correctly reverted to the last governing text on
disk and reported implementation blocked. That was A8 working, not a failure. This document is the
fix: it lands in the repo so that any session, with or without memory, finds what governs.

---

## 0. Standing position

**HMS-KS-002 v5 is CANCELLED.** Ruled by King B, 2026-08-13. There is no v5, no fifth prose gate
round, and no further spec revision in this window. Any instruction of the form "no implementation
until v5 is sealed" is superseded by this document.

**HMS-KS-002 v4 is PRESENT.** Pin
`sha256:9f99b1cca62dc2570c26a926239656cce707c3468d6ee009a8fe1383f1a10768`, verified in all 64
characters at `HMS-KS-002_v4_Phase1_Stack_and_Architecture.md`.

**Correction, recorded rather than absorbed.** The prior version of this order stated v4 was absent
and unrecoverable. That was false. The root cause of the false negative is known and named:
`find -maxdepth 4` was run against a file at depth 8, and the sweeps never covered the temp tree.
A negative proof is only as strong as the scope it searched, and a bounded search reported as an
absolute absence is the defect. Any claim in any artifact of this realm that v4 is absent is
withdrawn.

**What v4's presence does and does not change.** It supplies facts that were missing, chiefly the
role model at R5 and the invariant set. **It does not reopen v5.** The cancellation of v5 stands and
no revision cycle restarts. v4 is read as a reference for what to build, never revised, and never
sealed.

**HMS-RR-015 remains ABSENT**, with the caveat that the same bounded-search defect applies to its
negative proof. Absent artifacts are never reconstructed from quotation.

**A14 through A18 are not in force.** Negative proof against the staged `AMENDMENTS.md`: highest
amendment present is A13, and A14 through A18 return zero occurrences across tracked, untracked and
ignored paths. No artifact claims compliance with any of them.

**The remediation package is the design source for the state machine.** Pin
`sha256:a307a2f46f876c160b14c1a791026a443128e67c0c9108e5b5eac00060ed39a0`. Implement its proposals
as written rather than waiting for them to be restated here. It addresses fifteen of sixteen
findings and its COMPLETE claim is false by one. The missing finding is X7 and it is carried in B2
below.

**Write discipline.** Create, modify and stage freely. Do not commit. Do not push. Scratch writes
are permitted, so dash audits and post checks are run mechanically rather than asserted.

**Security, applying to every surface.** Never print, echo or interpolate a credential value into
any output, including presence checks. Test presence by exit status, never by expansion. A probe
that can print a secret on a branch not intended is a probe that will. The PGPASSWORD disclosure of
2026-08-13 is recorded rather than absorbed: the credential was rotated by King B, the variable
removed, the transcript dispositioned, and the repository verified clean across tracked, untracked
and ignored paths with nothing committed after the probe.

---

## 1. Rulings by King B carried into this order

All ruled 2026-08-13, relayed in session. Recorded with that scope. A sealing document supersedes
this block and its pin replaces this attribution.

**R-A. Operator removal is ungated and unconditional.** A staff member removes an unconfirmed
provisional entry with no role check, no approver and no second person. Bounded to `provisional`
only. Actor and reason written to the fairness log. Reason on the record: reinstatement moves
someone forward past people who joined earlier, which is what gates exist for; removing a ghost
moves nobody forward out of turn. Revisited at pilot.

**R-B. Close of day is branch policy, not a global rule.** Default is that the line resets. Roll
forward is available to a branch that chooses it. Set at branch configuration rather than as a
console button, so that a mid-operation policy flip cannot occur and no permissions model is
required to decide who may press it.

**R-C. The implementer never holds a superuser credential.** King B creates the three database roles
and supplies three connection URLs, one per role, each with its own limited password. R12 is not
amended and stands as written. Reason on the record: B1 proves each role's limits hold, and a
superuser credential in the same session makes that proof meaningless.

**R-D. v5 is cancelled and the build proceeds.** Remaining findings are proven by a compiler, a
database that rejects, and a test demonstrated capable of failing.

---

## 2. Architect defect, recorded rather than absorbed

Build Order 2's original B1 required the implementer to create three roles while R12 forbade the
only credential path that would allow it. **The order forbade its own required outcome.** This is
cluster (c), fourth consecutive occurrence, and this instance is the architect's rather than the
implementer's. It was reported and halted rather than worked around, which is why it is fixed here
instead of absorbed. B1 below is the corrected form.

---

## 3. The build

### B0. State stamp, then runtime proof. COMPLETE and COMMITTED 2026-08-13.

Node 24.15.0 executes TypeScript by native type stripping across a real cross-file import with an
explicit `.ts` specifier, no flag, `NODE_OPTIONS` unset. Break-restore proven, with the break placed
in the imported helper so a RED result also proves the cross-file import is load-bearing.

**Defect found and fixed.** `package.json`'s test script never worked: `node --test tests/` treats
the path as a module and dies with MODULE_NOT_FOUND. It shipped broken in `1603417` and went
unnoticed because `tests/` was empty. Corrected to `node --test "tests/**/*.test.ts"`.

**Observed state corrects this order's expectation.** B0 is committed at `2bbda7a`, not staged, at
+70/-1 rather than +60/-1. The delta derives exactly: `strip-probe.ts` was 28 insertions when this
order was written and is 38 now, the +10 being the provenance retraction. B0 survives in a stronger
state than expected. No action.

### B1. The database exists. BLOCKED on King B supplying connection URLs.

No database connection has ever been made from this repo. This remains the largest untested
assumption in the project.

**Given:** three connection URLs from King B, one per role.
**Not given, and not to be sought:** any superuser credential.

**Property one, connection.** Each of the three roles connects from this repo and reports its own
`current_user`. Three connections, three distinct users observed.

**Property two, limits.** Each role is proven bounded by attempting an operation it must not hold
and observing rejection.

**Role model source, ruled.** The prior version of this order sourced the role model from v2. **v2
contains no role model**, zero hits across seven search terms, so that instruction forbade its own
required outcome. Corrected: **the role model comes from v4 R5**, at the pin in section 0, which is
the only text on the machine containing one. v4 is PRIMARY for this and the implementer says so.

**With one correction applied, per remediation X3.** R5's grants are known defective: they leave two
reorderings alive, DELETE plus INSERT, and a backdated INSERT. Build the role model as R5 states it,
then apply B2's revokes, which close both. Do not build R5's grants as sound and do not treat this
as an endorsement of R5 generally.

Any grant that cannot be verified without superuser is reported as unverifiable rather than as
passing.

**Property three, migration.** Migration `001` is applied by `db/migrate.ts` using the DDL role's
URL, `schema_migrations` carries row `001` with its checksum, and a second run is observed to be a
no-op.

**Break-restore, mechanical.** Corrupt the recorded checksum, observe the runner refuse, restore,
observe it pass, and show the file byte-identical before and after.

If role creation itself proves to need something King B has not supplied, stop and name what is
missing rather than obtaining it another way.

### B2. The two tables that are the product.

One migration. Grants in the same migration, never retrofitted.

**`entries`:**

```sql
joined_at timestamptz NOT NULL DEFAULT now()

REVOKE INSERT (joined_at), UPDATE (joined_at) ON entries FROM hms_rw;
REVOKE DELETE                                 ON entries FROM hms_rw;
```

**`events`, the fairness log. THIS IS FINDING X7, ABSENT FROM THE REMEDIATION PACKAGE.** X7 is HIGH,
concerns invariant I8, and is a different table from X3. Append-only is unenforced today because
`hms_rw` holds UPDATE and DELETE on every table, so the audit trail is editable by the role it
exists to audit.

```sql
REVOKE UPDATE, DELETE ON events FROM hms_rw;
```

**Both revokes land in the migration that creates their table.** This closes the carried-obligation
exposure in one act: an instruction whose owning phase does not yet exist is the failure mode, and
naming the creating migration as the owner removes it. This covers `REVOKE UPDATE(joined_at)` as
well as the events revokes.

**Branch configuration.** If a locations table does not yet exist, create it. If location lives
elsewhere in v2, put these there and say so.

```sql
close_of_day_policy text NOT NULL DEFAULT 'reset'
  CHECK (close_of_day_policy IN ('reset','roll_forward'))
timezone text NOT NULL DEFAULT 'America/Jamaica'
```

**Property, proven at runtime as `hms_rw`, not by reading the migration.** Five rejections, each
observed: a backdated INSERT into `entries` is rejected; an UPDATE of `joined_at` is rejected; a
DELETE from `entries` is rejected; an UPDATE of an `events` row is rejected; a DELETE from `events`
is rejected. Break-restore on at least one.

**Tier consequence.** I1 and I8 are tier V until these grants exist and reject. They become tier S
on B2's completion. Claiming S before the mechanism exists is the defect; naming the owner and the
criterion is the fix.

### B3. The state machine and the demo moment.

Implement from the remediation package as written, at the pin in section 0.

- **X8 channels.** `qr` and `reception` are on-site, enter at `waiting`, auto-confirmed. `whatsapp`
  is the only remote channel and the only one producing a `provisional` entry.
- **X8 transport.** Bounded send attempts, default 3. If all fail the entry becomes `undeliverable`
  and the window runs from the last attempt, so every provisional entry has a clock.
- **X8 third exit.** `provisional -> left`, trigger `operator_removal`, ungated and unconditional
  per R-A. Permitted only from `provisional`. Actor and reason written to `events`.
- **X9a.** The expiry sweep's write is conditional:
  `WHERE status = 'provisional' AND confirmed_at IS NULL`. Plus the bounded reversal,
  `left -> waiting`, ungated, only where `left_reason = 'provisional_expiry'`, original `joined_at`
  retained.
- **X9b.** `prompt_sent` and `prompt_delivered` are not statuses. They are columns:
  `prompt_sent_at`, `prompt_delivered_at`, `prompt_failed_at`, `confirmed_at`, `undeliverable_at`,
  all nullable `timestamptz`. The status set stays at v2's seven.
- **X10.** All queue writes take `pg_try_advisory_xact_lock(location_id)` inside an explicit
  transaction. Transaction scope, non-blocking. A failed acquisition returns a typed skipped result
  to the caller and increments an operational counter. Operational event, not a fairness event.
- **X13.** Rework `orchestrator/apply/index.ts`, which is a barrel today. It exposes named
  operations and never re-exports a pool, a client, or any value obtained from `persistence/write/`.
- **The governed write function, closing CO-2.** The prior version of this order named no owner for
  fairness event emission, so I8's mechanism had the same exposure the revokes had. Corrected.
  **Property:** every write that changes an entry's status or its place in line, and the `events`
  row recording it, occur inside one transaction through one function in `orchestrator/apply/`.
  No other module writes to `entries`. The implementer selects the shape and the name; this order
  states the property. **Tier honesty:** this is V until something rejects a write that bypasses it,
  and C once a test asserts the function is the only writer. It is not S and is not to be described
  as append-only enforcement, which is what B2's revokes provide.

**Acceptance for B3 is the demo moment, end to end, against the live database.** A remote WhatsApp
join lands provisional; Call Next visibly skips it; one tap confirms; the next Call Next serves
them. This is what the whole build is for. Prove it before moving on.

### B4. Close of day.

Per R-B. Read policy from `close_of_day_policy`. Operation `closeOfDay(location_id)`, triggered by
the operator from the console. No scheduler this pass. Runs in one transaction and takes
`pg_try_advisory_xact_lock(location_id)` like every other queue write.

- **Under `reset`:** every entry in `waiting`, `provisional`, `called` and `undeliverable`
  transitions to `left` with `left_reason = 'close_of_day'`.
- **Under `roll_forward`:** entries in `waiting` keep their status and their original `joined_at`
  and carry to the next day. Entries in `provisional`, `called` and `undeliverable` are released
  regardless of policy, because an unconfirmed entry carried overnight takes the front of the next
  day's line, which is the harm X8 exists to prevent.
- **Under both:** entries in `serving` are untouched. The operator completes them.

Every released entry writes its own row to `events`. A bulk release is many place-in-line changes,
not one, and I8 requires each to be recorded. Customer notification is a B5 concern; leave the hook.

**Property.** Seed a queue containing all statuses, run `closeOfDay` under each policy, observe the
resulting status of every entry, and observe that the count of new event rows equals the count of
entries transitioned.

### B5. Transport.

Twilio WhatsApp sandbox, with the simulated WhatsApp surface built in parallel as a fallback capable
of carrying the demo alone. Neither becomes the only path.

### B6. Console.

Two-sided, matching the behavior of the prototype at `docs/hold-my-spot-prototype.html`. The
prototype is not modified and stays intact as the fallback submission.

---

## 4. Deferred deliberately

The boundary checker and findings X1, X2, X6, X12, X13's checker half, and X14 are not built this
pass. They protect properties of product code that did not exist when they were written. Two rules
carry forward and are kept true by hand:

- `orchestrator/apply/` never re-exports a pool, a client, or any value obtained from
  `persistence/write/`.
- `agents/`, `domain/` and `governance/` import no external package and no node builtin. Both
  already satisfy this.

---

## 5. Reporting

Report at staged, per surface, stating the property proven and the instrument chosen. The
implementer selects the instrument; this order states the property. Protected words require
break-restore proof. Post checks run after authoring, mechanically, never asserted in advance.
ABSENT, UNRESOLVED and UNSATISFIABLE remain honest answers. **If a constraint in this order forbids
its own required outcome, say so and stop rather than working around it.** That has already happened
once and the report of it was correct.

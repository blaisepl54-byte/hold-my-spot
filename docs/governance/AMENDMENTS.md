# HMS Amendments, A1 through A13

**Realm:** holdmyspot
**Purpose:** the repo-resident record of every ratified amendment governing this realm.
**Basis:** A8. Governance text is a repo artifact or it is not in force.
**Landed by:** Claude Code, on King B's ratification of 2026-08-11.
**Snapshot stamp per A5.1:** written against `git:b527157`.

---

## Provenance and fidelity, VERIFIED 2026-08-11

A8 exists because rules that live only in the documents citing them are unverifiable. This file is
the fix. The first issue of it was itself unverified for six of eight amendments, and that gap is
now closed: King B relayed the sealed originals as files and every amendment below has been diffed
against its source.

**Sources, pinned per A7:**

| Source document | Bytes | Pin |
|---|---|---|
| `HMS-KS-001-A1_Amendment_and_P0_Disposition.md` | 13,107 | `sha256:e9104f385f441565efff519d5af4f88a70d947d76e35378aaf2f8efe8ef1204b` |
| `HMS-KS-001-A2_Hash_Portability_and_DataRoom.md` | 7,630 | `sha256:b8271fb2e2b32826b938b4906c9fcc877e4aa876c6f12aab673bcf3d53861942` |
| `HMS-RR-003_Closure_Correction_and_A3.md` | 9,820 | `sha256:aa5b596d46e48e7887be73e1fb309481cd8b60fe044e56eb5b179cc939de39e2` |
| `HMS-RR-004_CLAUDEmd_Correction_Harness_Findings_A4.md` | 11,775 | `sha256:d28f8ed6a22c880ebbf7cf8acb354ae38d7089c5a1d07a451631791fc816e4ac` |
| `HMS-RR-005_Verifier_Closure_and_A5.md` | 8,236 | `sha256:db20b77f868361c40f0f63cf255d7972bb671dde7e6c4026705fb4ac77431ac2` |
| `HMS-RR-007_CLAUDEmd_State_Claim_Corrections.md` | 8,559 | `sha256:7639311aa2938a694f3ae808824319b55c346ccaecce8b38c371e3939a4c78b0` |
| `HMS-RR-008_D5_README_Corrections_A6.md` | 11,333 | `sha256:f52736cc12940b4163083c13ee94206daa84e38a9664bb2d51c5959ec7667b40` |
| `HMS-RR-009_Gate_Rulings_A7_A8.md` | 13,060 | `sha256:3cd5ff7c908a90cbde6c0ef37375e6c3c0338648b6035e27710ed9d3f4d96dca` |

Delivered inside `HMS.zip`, `sha256:27f148b525c962b121b1a3f14b1a332534ca3b3dd4a727f4adcc67b627c756e2`.
**No expected hashes were supplied with the relay**, so these are the hashes of what arrived, not a
verification against values stated in advance. One independent cross-check succeeded: RR-004's
`sha256:d28f8ed6a22c880e…` matches the pin RR-005 recorded for it at authoring time, which is
evidence the relayed file is the document RR-005 referred to.

**Per-amendment diff result:**

| Amendment | Result | Note |
|---|---|---|
| A1.1 | **EXACT** | |
| A1.2 | **EXACT** | |
| A2.1 | **EXACT** | Substance and the fix block verbatim. This entry additionally carries RR-009's corrected justification, marked in place as a later amendment rather than as A2.1 text. |
| A3.1 | **EXACT** | |
| A3.2 | **EXACT** | |
| A3.3 | **EXACT** | |
| A3.4 | **EXACT** | |
| A4.1 | **EXACT** | Text verbatim. The status table originally labelled it "execution and review axes"; the source heading is "three axes". Label corrected. |
| A4.2 | **EXACT** | |
| A4.3 | **EXACT** | |
| A5.1 | **DRIFT, corrected** | The first issue omitted the source's "Applied to Claude's own documents, unprompted" paragraph, which stamps the RR-004 seal card as a snapshot. Restored below. The two corollaries in this entry are **later additions**, not sealed A5.1 text, and are now labelled as such. |
| A5.2 | **EXACT** | |
| A5.3 | **EXACT** | |
| A6.1 | **EXACT text, PROVENANCE DRIFT corrected** | The first issue attributed A6.1 to RR-006 Part A. It is **RR-008 Part A**. RR-006 carries no amendment and was not relayed. |
| A6.2 | **DRIFT, corrected** | The first issue dropped two qualifiers from the phase-1 scope sentence: acceptance criteria *"including connection-proven for Postgres and docker"*, and the line-ending policy *"deferred from seal card item 27"*. Restored below. **The docker qualifier is load-bearing, see the conflict note under A6.2.** |
| A7 | **EXACT** | Transcribed from the pinned RR-009 file in the first issue. |
| A8 | **EXACT** | Transcribed from the pinned RR-009 file in the first issue. |

**ABSENT:** `HMS-RR-006` was not relayed. Nothing depends on it: A6.1 lives in RR-008, and RR-006's
content (Phase 0 closure, the dash sweep, the Rung 2 validation kit) carries no amendment.
`HMS-KS-001`, `HMS-RR-001` and `HMS-RR-002` were likewise not relayed and carry no amendments.

Fourteen of seventeen entries were EXACT on first transcription. Three drifted, all by omission
rather than invention, and all are corrected in this issue.

**Ratification dates** below are the dates the sealing order reached CC, evidenced by the order that
cited the amendment as its BASIS. They are not necessarily King B's internal seal dates, and no
attempt is made to infer those.

---

## Status table

| # | Name | Sealed | Status |
|---|---|---|---|
| A1.1 | Closing line, two-string convention | 2026-08-04 | Superseded by A4.1 |
| A1.2 | Ledger placement | 2026-08-04 | In force |
| A2.1 | Hash portability, typed verification | 2026-08-05 | In force |
| A3.1 | Artifacts pinned by hash at submission | 2026-08-06 | In force, extended by A7 |
| A3.2 | Revision voids a ruling as to specifics | 2026-08-06 | In force |
| A3.3 | Locations cited with the hash counted against | 2026-08-06 | In force |
| A3.4 | Two-axis closing line | 2026-08-06 | **Withdrawn** by A4 |
| A4.1 | Closing line, three axes | 2026-08-06 | In force |
| A4.2 | Identity is evidenced, never assumed | 2026-08-06 | In force |
| A4.3 | Findings state reported separately from verdict | 2026-08-06 | In force |
| A5.1 | No live currency inside a static artifact | 2026-08-06 | In force |
| A5.2 | Closing line carries the reviewed hash | 2026-08-06 | In force |
| A5.3 | Executable text travels in the CC block | 2026-08-06 | In force |
| A6.1 | Post-check conflict resolution (source: RR-008 Part A) | 2026-08-06 | In force |
| A6.2 | Corrected phase map (source: RR-008 Part E) | 2026-08-06 | In force, **amended by A9** (docker struck) |
| A7 | Hash pins are typed | 2026-08-11 | In force |
| A8 | Governance text is a repo artifact | 2026-08-11 | In force |
| A9 | Docker struck from Phase 1's required criteria | 2026-08-11 | In force |
| A10 | Gated acts sit in the post-gate segment | 2026-08-11 | In force |
| A11 | Pins round-trip before handoff | 2026-08-11 | In force |
| A12 | Values come from the primary artifact | 2026-08-11 | In force |
| A13 | Relays state filename and pin | 2026-08-11 | In force |

Standing rules that are not numbered amendments are recorded at the end.

---

## A1.1, closing line, two-string convention

**Superseded by A4.1. Retained because rulings sealed before 2026-08-06 were written against it.**

HMS-KS-001 §4 mandated a verbatim closing string without naming who performs the review the string
asserts, so a report authored and read only by its author could emit a spec-compliant line claiming
a review that never happened.

The convention adopted:

- No independent review round: `authored, STAGED, NO INDEPENDENT REVIEW, awaiting King B's seal`
- Independent review completed in fresh context:
  `review-passed by <reviewer identity>, STAGED, awaiting King B's seal`

Rules attaching:

1. The reviewer must be a distinct context from the author. Same-session self-review does not
   qualify and must use the first string.
2. The second string names the reviewer. An unnamed reviewer is not a review.
3. Emitting the second string without a completed independent round is a doctrine breach, not a
   formatting error.
4. **Where an author is instructed to emit a string that the facts do not support, the author emits
   the honest string and records the divergence. Spec text does not override observed fact.**

Rule 4 generalizes beyond the closing line and survives A1.1's supersession.

## A1.2, ledger placement

Every phase spec states its ledger disposition explicitly, in one of two forms:

- **Read-only phases:** the ledger goes to the session scratchpad. The tree being mapped is not
  written to, including gitignored paths.
- **Build phases:** the harness ledger at `./.workflow/LEDGER.md` is permitted and expected. It is
  gitignored, it is the doctrine location, and cross-session continuity is worth more than the
  cleanliness of an ignored path.

Silence in a phase spec on this point is a spec defect, not a permission.

---

## A2.1, hash portability and typed verification

**The defect.** A manifest published SHA-256 of working-tree bytes without pinning what produces
those bytes. With `core.autocrlf=true` and no `.gitattributes`, a fresh clone checks out CRLF and
every hash fails, so the manifest verified only on the machine that wrote it. The landed content was
never wrong; the verification instruction was.

**The fix.** `.gitattributes` carries `docs/** -text`, exempting grounding paths from line-ending
normalization. No `git add --renormalize` is required where stored blobs are already LF.

**Typed verification.** Verification of a hashed artifact is specified as:

- **Authoritative, platform-independent:** `git cat-file blob HEAD:<path> | sha256sum`. Hashes the
  stored blob, invariant regardless of anyone's `core.autocrlf`, editor, or platform.
- **Convenient, working tree:** `sha256sum <path>`. Valid only where the attribute exemption is in
  place. This checks the reader's checkout configuration as much as the file.

A mismatch on the authoritative check means stop and report.

**Corrected justification, per RR-009 Part B.** The `docs/** -text` rule follows the global rule not
because reversing it would break the manifest (it would not; reversed, `docs/**` resolves to
`text=auto eol=lf`, forcing the same LF bytes the manifest hashes), but because it **decouples** the
grounding bytes from the eol policy, so a later change to the global rule cannot silently alter what
the manifest hashes.

---

## A3.1, artifacts are pinned at submission

Any artifact submitted for a ruling carries a version identifier and a SHA-256 at the point of
submission. Rulings cite the artifact by hash, not by name alone.

## A3.2, revision voids a ruling as to specifics

If an artifact is revised after submission and before the ruling is sealed, it is re-submitted with
a new hash. A ruling authored against a superseded version is void as to specifics, whether or not
its reasoning survives.

## A3.3, locations are cited with the hash counted against

Where a ruling cites locations inside an artifact, it cites the hash it counted against. Line
numbers without a pinned hash are not evidence; they are a snapshot of one reader's copy.

## A3.4, two-axis closing line

**WITHDRAWN by A4.** Partial execution was a real improvement and is retained in A4.1. It was not
the gap it was written to close. The actual gap was a review that completed and did not pass, which
A3.4's review axis could not express.

---

## A4.1, the closing line

```
<execution>, STAGED, <review>, awaiting King B's seal
```

**Execution axis**

- `authored` when the order was executed in full
- `authored, PARTIAL: steps <n> executed, step <m> deferred`

**Review axis**

- `NO INDEPENDENT REVIEW`
- `reviewed by <identity>, VERDICT <PASS|PARTIAL|FAIL>, findings <discharged|open: n>`

Where identity cannot be established, the slot reads `UNRESOLVED` followed by whatever the reviewer
positively qualifies as. `UNRESOLVED` is a permitted and honest value. An empty or omitted identity
is not.

## A4.2, identity is evidenced, never assumed

**A named reviewer may be written into a closing line only where positive evidence establishes that
the named agent served the call.** Requesting an agent by name is not evidence that it answered. A
dispatch record proves what was asked for, not what ran.

Where the mechanism cannot furnish that evidence, `UNRESOLVED` is written and the review still counts
for what it is: a competent independent read whose author cannot be named. That is worth
considerably more than nothing and considerably less than a named pass, and the line says so rather
than rounding in either direction.

## A4.3, findings state is reported separately from verdict

A PARTIAL verdict with all findings discharged and a PARTIAL verdict with four findings open are
different states, and a reader deciding whether to seal needs to see which. Hence the explicit
`findings` clause in A4.1.

---

## A5.1, no live currency inside a static artifact

Any section of a governance artifact asserting current state carries a date and the commit it was
observed at, plus the commands to refresh it. A static document may not assert live currency.

A snapshot honestly labelled is durable. A live claim frozen in a file is a defect on a timer.

**Applied to Claude's own documents, unprompted.** The consolidated seal card in RR-004 Part D
asserts current open and closed status with no snapshot stamp. It is the same defect in the same
week. It is hereby stamped: that card is a snapshot as of 2026-08-04 at repo `git:e9b7188`, and it
is reissued rather than read as live whenever status is in question. The grounding manifest is
already safe on this axis because it pins hashes rather than states.

*The two corollaries below are NOT sealed A5.1 text.* They were ruled in later documents (RR-007
Part A and the RR-008 disposition) and are recorded here so they are not orphaned. Flagged rather
than merged, per the A5.1 diff result.

**Corollary, added after three instances.** A state claim that also carries an *instruction* is a
worse category than an inert one: it does not merely rot, it reproduces, because a session follows a
correct instruction attached to a wrong premise. Such lines are high priority for pinning regardless
of how harmless the assertion looks alone.

**Corollary, added after the fourth instance.** When a state claim is corrected, search the repo for
the claim's substance before closing the item, not just the file it was found in. A claim appearing
in two files gets corrected in one and lives on in the other.

## A5.2, the closing line carries the reviewed hash

Remediation always postdates review. A report reviewed at one hash and corrected into another can
never truthfully say the current version was reviewed, and requiring a fresh round after every
remediation is an infinite regress.

The review axis reads:

```
reviewed at <artifact hash> by <identity>, VERDICT <PASS|PARTIAL|FAIL>,
findings <discharged in this revision | open: n>
```

The gap between the reviewed hash and the current hash is disclosed rather than hidden. A fresh
round is required only where remediation changed load-bearing content rather than discharging
specific enumerated findings.

## A5.3, executable text travels in the CC block

Anything CC must execute against is reproduced inside the fenced instruction block in full, even
where that duplicates an attachment. Attached documents are for King B.

**Known gap, recorded.** A5.3 closed the class for text CC *executes* against. It did not close it
for text CC is asked to *verify* against. A8 closes the remainder.

---

## A6.1, post-check conflict resolution

Where a post-check states both an expected value and a justification, and they conflict, **the
justification governs.** The implementer reports the discrepancy and the derivation rather than
acting to produce the stated number.

Where a post-check can state a property rather than a predicted value, it should. "Report the count
and the derivation" is safer than "expect 1", because a predicted value invites an implementer to
close the gap rather than report it.

This is the same shape as the review rule: the reasoning outranks the label.

## A6.2, corrected phase map

HMS-KS-001 §5 defined Phase 1 as a "spec-adversarial review gate on the Phase 1 build spec," which is
circular: it defines a phase as the review of a document the phase does not produce, and confuses a
gate with a phase. **A gate runs on an artifact. A phase produces one.**

- **Phase 1, Stack and Architecture.** Produces a ratified spec covering: the stack and package
  manager, the repo layout and module boundaries, the queue domain model carried over from the
  prototype, the acceptance criteria every later phase is measured against **including
  connection-proven for Postgres and docker**, the repo-wide line-ending policy **deferred from seal
  card item 27**, and the explicit statement that no memory carries between CC sessions until the
  Igris partition exists.

> **CONFLICT, RESOLVED 2026-08-11 by A9.** A6.2 as sealed required Phase 1's acceptance criteria to
> include **connection-proven for docker**, while HMS-KS-002 R6 ruled docker out of scope and closed
> the Phase 0 abstention "by disuse". Those could not both hold. **A9 strikes the docker clause**, so
> the docker qualifier above is superseded and connection-proven applies to Postgres alone. The
> qualifier is left in the A6.2 text rather than deleted, because rulings sealed before 2026-08-11
> were written against it.
>
> Recorded for the method rather than the outcome: this conflict surfaced only because the omitted
> qualifier was restored during the fidelity diff against relayed originals. Reading the
> transcription however carefully would not have found it, which is the argument for A8 and for
> diffing against sources rather than against memory.
- **The spec-adversarial gate is a named gate, not a phase.** It runs on every build-phase spec
  before that phase opens, starting with Phase 1's own. Findings logged or the round did not happen.
  Under A4.2 and P0-F10 it runs as a fresh CC session in clean context.
- Phases 2 through 8 unchanged: queue state machine, Wait Time Agent, orchestrator and governance
  gates, WhatsApp transport, adherence on the console, Conversation Agent in English and Patois,
  demo capture.

---

## A7, hash pins are typed

Every pin carries its type: `sha256:` or `git:`. **An unlabeled hash is not a pin.**

This applies retroactively to citation, not to already-sealed documents, which are read with the
type inferred and noted.

Origin: A3 required pinning by hash but did not require saying which kind, creating an ambiguity
that satisfied the rule while defeating its purpose. A spec header mixed a git short hash with an
unlabeled sha256; `git cat-file -t b01ef89e` returns "not a valid object name" because `b01ef89e`
was a sha256 prefix while the artifact's git blob was `c5f13499`.

## A8, governance text is a repo artifact or it is not in force

Every ratified amendment lands in the repo as a file before any artifact may cite compliance with
it. A rule that exists only in the documents citing it is unverifiable, and an unverifiable rule is
decoration.

**Deliverable:** this file, `docs/governance/AMENDMENTS.md`, carrying every ratified amendment in
full with its ratification date, landed as a forward-only commit. Every future amendment lands here
in the same commit that seals it. *(Originally written as "A1 through A8", which became a stale
state claim in a title the moment A9 through A13 landed. The count is now stated by the status table
rather than duplicated in prose.)*

Until this file exists, no artifact may claim compliance with an amendment. It may cite one as
proposed.

---

## A9, docker struck from Phase 1's required criteria

A6.2 is amended to strike docker from Phase 1's required acceptance criteria. Connection-proven
applies to Postgres. Docker is out of scope per KS-002 R6, closed by disuse rather than by proof. If
a later phase adopts docker, connection-proven applies to it then, in that phase's spec.

*Resolves the A6.2 / R6 conflict recorded under A6.2 below, which was surfaced by the fidelity diff
of 2026-08-11 and reported unresolved until this seal.*

## A10, gated acts sit in the post-gate segment

Any acceptance criterion whose evidence requires a commit or a push sits in the post-gate segment of
its phase. A criterion the implementer cannot satisfy without performing a gated act is a permission
inversion.

## A11, pins round-trip before handoff

Every pin in a governance record round-trips before handoff: the value as written is re-extracted and
compared against the source hash. This runs with the dash audit, as a post-write check rather than an
authoring instruction. A rule aimed at an author's intent cannot close a defect introduced by a
renderer.

## A12, values come from the primary artifact

Any value entering a governance record, meaning a count, a date, a status or a location, is taken
from the primary artifact or is marked as relayed and unverified. A number quoted from a summary
carries the summary's scope, not the artifact's.

## A13, relays state filename and pin

Every relay states the filename and the pin of the file being sent, and the receiving party verifies
the pin before acting. A file whose pin does not match what was announced is treated as not received.

---

## Standing rules, not numbered amendments

### Boundaries are allowlists, never denylists

Ruled in HMS-RR-009 Part A. A denylist only blocks the edges someone thought to enumerate.
Allowlists are complete by construction: everything not permitted is forbidden, including the paths
nobody thought of. Boundary rules in this realm are expressed as allowlists.

**Honest limitation, recorded rather than glossed:** a static import scan does not catch dynamic
`import()` or runtime string-built requires. For a solo build with no adversary inside the repo,
static coverage is proportionate. It is a real gap and it is written down rather than implied to be
airtight.

### Governance artifacts move through King B's hands only

Ruled 2026-08-11. Governance artifacts in this realm are relayed via King B (the Downloads path) and
are not transmitted over the inter-session agent bridge, until a bridge session carries a verified
named identity. "The architect" on that bridge is unverifiable today, so there is no standing
exception.

Origin: CC declined to transmit a document carrying private governance internals to thirteen
auto-named bridge sessions, none identifiable as the intended recipient. Declining on the
implementer's own judgment is the disclosure discipline G-1 exists for.

### Relayed findings carry a verification column

Ruled 2026-08-11. House practice for any relayed finding set: mark each finding **VERIFIED** (the
relayer re-derived it independently), **FROM TEXT** (readable directly in the pinned artifact), or
**GATE ONLY** (not independently re-derived). GATE ONLY items must not borrow credibility from
re-derived ones.

### Where a review's summary and body disagree, the body governs

Ruled in HMS-RR-005 Part A. A review whose summary and body disagree has a second defect beyond
whatever it found. Same shape as A6.1: the reasoning outranks the label.

### Completion criteria never instruct toward a gated act

Ruled 2026-08-11 in the G4 disposition. The implementer's portion of any completion criterion ends
at *staged*. Push, merge, deploy and other gated surfaces are King B's explicit go, and a criterion
that requires one of them pushes an implementer optimizing for the criteria toward an unauthorized
act.

### Protected words

"Verified", "completed", "fixed" and "working" require break-restore proof on the live path: the
break applied, RED observed, the break removed, GREEN observed, both recorded with output. Absent
that, the honest phrasing is "implemented, break-proof pending". Assert runtime values, never
source-text matches.

### G-1, the repo stays private

Real contact data is permanent in this repo's pushed history from `git:0ea570e`. The repo stays
private for the life of the project. Making it public requires an explicit one-time sealed
exception authorizing a history rewrite, which collides with forward-only and has not been granted.

---

## Maintenance

Every future amendment lands here in the same commit that seals it, per A8. When King B supplies the
sealed originals of the A1 through A6 source documents as files, this document is diffed against
them and reissued, and the fidelity table at the top is updated to reflect a checkable provenance.

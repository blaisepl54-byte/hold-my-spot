# HMS Amendments, A1 through A8

**Realm:** holdmyspot
**Purpose:** the repo-resident record of every ratified amendment governing this realm.
**Basis:** A8. Governance text is a repo artifact or it is not in force.
**Landed by:** Claude Code, on King B's ratification of 2026-08-11.
**Snapshot stamp per A5.1:** written against `git:b527157`.

---

## Provenance and fidelity, read this first

A8 exists because rules that live only in the documents citing them are unverifiable. This file is
the fix. It is also, for six of the eight amendments, subject to the same defect it closes, and that
is stated here rather than discovered later.

| Source | Exists as a file? | Pin | Fidelity of the text below |
|---|---|---|---|
| `HMS-RR-009_Gate_Rulings_A7_A8.md` | **yes** | `sha256:3cd5ff7c908a90cbde6c0ef37375e6c3c0338648b6035e27710ed9d3f4d96dca` | **Checkable.** A7 and A8 transcribed from a pinned file. |
| A1, A2, A3, A4, A5, A6 source documents | **no** | none | **UNVERIFIED.** Transcribed by CC from text pasted into the session. No original file exists on this machine to diff against. |

So: A7 and A8 can be checked against a hashed artifact. **A1 through A6 cannot.** They are recorded
here in good faith and to the best available fidelity, and the moment King B supplies the sealed
originals as files, this document should be diffed against them and reissued.

This is the same class as the transcription caveat on
`docs/HoldMySpot_WhatsApp_Integration_Path.md`, and it is the third time it has bitten this realm.
Recording it is not a reason to withhold the file. An unverifiable record of the rules is worth more
than no record, because it can at least be checked *against* once originals arrive; but it must not
be mistaken for a verified one.

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
| A4.1 | Closing line, execution and review axes | 2026-08-06 | In force |
| A4.2 | Identity is evidenced, never assumed | 2026-08-06 | In force |
| A4.3 | Findings state reported separately from verdict | 2026-08-06 | In force |
| A5.1 | No live currency inside a static artifact | 2026-08-06 | In force |
| A5.2 | Closing line carries the reviewed hash | 2026-08-06 | In force |
| A5.3 | Executable text travels in the CC block | 2026-08-06 | In force |
| A6.1 | Post-check conflict resolution | 2026-08-06 | In force |
| A6.2 | Corrected phase map | 2026-08-06 | In force |
| A7 | Hash pins are typed | 2026-08-11 | In force |
| A8 | Governance text is a repo artifact | 2026-08-11 | In force |

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

- **Phase 1, Stack and Architecture.** Produces a ratified spec covering the stack and package
  manager, repo layout and module boundaries, the queue domain model carried from the prototype, the
  acceptance criteria every later phase is measured against, the repo-wide line-ending policy, and
  the explicit statement that no memory carries between CC sessions until the Igris partition exists.
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

**Deliverable:** this file, `docs/governance/AMENDMENTS.md`, carrying A1 through A8 in full with
ratification dates, landed as a forward-only commit. Every future amendment lands here in the same
commit that seals it.

Until this file exists, no artifact may claim compliance with an amendment. It may cite one as
proposed.

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

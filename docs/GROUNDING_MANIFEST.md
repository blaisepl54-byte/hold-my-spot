# HMS Grounding Set Manifest, v2

**Realm:** holdmyspot
**Supersedes:** v1, staged 2026-08-04. v1 is void. Its hashes were correct but its verification
method was not portable, per HMS-KS-001-A2 Part A.
**Issued:** 2026-08-04

---

## What changed from v1

v1 published SHA-256 of working-tree bytes without pinning what produces those bytes. With
`core.autocrlf=true` and no `.gitattributes`, a fresh clone checks out CRLF and every hash fails,
so the manifest verified only on the machine that wrote it. The landed content was never wrong.
The verification instruction was.

v2 hashes the same bytes and changes what you run to check them.

**Dependency.** v2 assumes `.gitattributes` carrying `docs/** -text` is in the repo. Without it the
working-tree check fails on Windows clones. The authoritative check below passes either way.

---

## Verification

**Authoritative, platform-independent. Use this one.**

```
git cat-file blob HEAD:docs/<file> | sha256sum
```

Hashes the stored blob. Invariant regardless of anyone's `core.autocrlf`, editor, or platform.

**Convenient, working tree.**

```
sha256sum docs/<file>
```

Passes once `.gitattributes` is in place. Fails on a Windows clone without it. This is a check of
your checkout configuration as much as of the file.

Any mismatch on the authoritative check: stop and report. Do not proceed with what arrived.

---

## Files

| File | SHA-256 | Bytes (LF) | Lines | Provenance |
|---|---|---|---|---|
| `hold-my-spot-prototype.html` | `b1293e7304698e0c7913c1b4a721dc199a7a2d9b82958f5a0dcea7a63759239f` | 28581 | 499 | Original, byte-identical to the file supplied in session as `hold-my-spot-prototype__1_.html`. Renamed only. |
| `hold-my-spot-business-plan-handoff.md` | `343831f2e5e2aea01e028cdee971d7dcd058415e1cffc79c9b56109eccc34c49` | 21872 | 360 | Original, unmodified. Product brief of record per HMS-RR-001 item 2. |
| `HoldMySpot_BUILD_Handoff.md` | `a637b5c2f1db3686310ccac75083e3caadb9eb55b6c4f65a334f8d9299c353f8` | 13405 | 133 | Original, unmodified. |
| `HoldMySpot_WhatsApp_Integration_Path.md` | `907aef6b5a1dd2a97b49b206d016289f13d5949c55e8f16e7c24e091c26e30c8` | 6840 | 79 | **TRANSCRIPTION, not the original.** See caveat below. |
| `HoldMySpot_Competitive_Onepager.md` | `23a1a36ec2906bf653351b38099ac1ddea26517b7cc605cc7799e6a3f882bdf2` | 5979 | 73 | Original, unmodified. |
| `HoldMySpot_Competitive_Onepager.pdf` | `b77c03f5249fccf6372ca1204c936cc9463deaaed52bb74305f9f19757995457` | 28597 | binary | Original, unmodified. Derived from the .md above. |
| `HoldMySpot_Agentic_Workflow.pdf` | `c3da8ae46d62242c46d044c8d2d7f44b821ffb15aa834da13221579cae6e19df` | 39969 | binary | Original, unmodified. Submitted with the application. |

Line counts are published so a size mismatch can be diagnosed rather than merely detected. A clone
showing size plus line count is a line-ending conversion, not a content change.

The two PDFs are binary. Git performs no conversion on them and both checks agree on any platform.

---

## Data Room classification

Landing in the repo is not clearance for the Data Room. Per HMS-KS-001-A2 Part B:

| File | Data Room |
|---|---|
| `hold-my-spot-business-plan-handoff.md` | Safe. Product brief of record. |
| `HoldMySpot_Agentic_Workflow.pdf` | Safe, subject to a rendered read before upload. |
| `HoldMySpot_Competitive_Onepager.md` / `.pdf` | Names Trogon United only. King B's ruling, recommendation is keep. |
| `hold-my-spot-prototype.html` | Safe. |
| `HoldMySpot_BUILD_Handoff.md` | **EXCLUDED.** Real contact data at line 11, entity note at line 118. |
| `HoldMySpot_WhatsApp_Integration_Path.md` | **EXCLUDED.** Names SoSave and its financial-rails approvals at lines 3, 14, 16. |

---

## Transcription caveat, HoldMySpot_WhatsApp_Integration_Path.md

This document reached the session as pasted text, not as an uploaded file. The staged copy is a
Claude transcription. The hash pins what the repo holds. It does not establish fidelity to King B's
original, because no original was available here to diff against.

Resolution, King B's choice: supply the original so it replaces this file and the hash is reissued,
or read the staged copy against his own and confirm, after which the manifest carries his
confirmation and the transcription status stays on the record. Until then no downstream document
may cite it as an original source.

---

## Not in this set

- `hold-my-spot-mockups.html`. Confirmed absent per P0-F2, whole-repo sweep, zero HTML files in the
  repo at Phase 0. Disposition under seal card item 12: not a build dependency, no rebuild during
  the sprint, Data Room only if a copy surfaces.
- The Claude project instructions. They govern how Claude operates in this project. Not a realm
  grounding document, and they do not belong in the repo.

---

## Standing constraint

Real contact data is permanent in this repo's history as of the grounding landing. The repo stays
private for the life of the project. Making it public requires an explicit one-time sealed
exception authorizing a history rewrite. See HMS-KS-001-A2 Part C.

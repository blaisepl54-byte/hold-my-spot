# HMS Grounding Set Manifest

**Realm:** holdmyspot
**Staged by:** Claude, 2026-08-04
**Purpose:** closes seal card item 13, the P0-F3 grounding gap. Six of the seven documents named in
HMS-KS-001 §2 were absent from the repo and unavailable to the Phase 0 session. This manifest lands
them with verification hashes so CC checks what arrives rather than trusting it.

**Prerequisite.** Seal card item 22. The GitHub remote's private status is asserted by the prior
ledger and was not re-probed in Phase 0, and landing this set is a push. Confirm private BEFORE the
commit, not after. The business plan is in this set.

---

## Files

| File | SHA-256 | Bytes | Provenance |
|---|---|---|---|
| `hold-my-spot-prototype.html` | `b1293e7304698e0c7913c1b4a721dc199a7a2d9b82958f5a0dcea7a63759239f` | 28581 | Original, byte-identical to the file King B supplied in session as `hold-my-spot-prototype__1_.html`. Renamed only. |
| `hold-my-spot-business-plan-handoff.md` | `343831f2e5e2aea01e028cdee971d7dcd058415e1cffc79c9b56109eccc34c49` | 21872 | Original, unmodified. Product brief of record per HMS-RR-001 item 2. |
| `HoldMySpot_BUILD_Handoff.md` | `a637b5c2f1db3686310ccac75083e3caadb9eb55b6c4f65a334f8d9299c353f8` | 13405 | Original, unmodified. |
| `HoldMySpot_WhatsApp_Integration_Path.md` | `907aef6b5a1dd2a97b49b206d016289f13d5949c55e8f16e7c24e091c26e30c8` | 6840 | **TRANSCRIPTION, not the original.** See caveat below. |
| `HoldMySpot_Competitive_Onepager.md` | `23a1a36ec2906bf653351b38099ac1ddea26517b7cc605cc7799e6a3f882bdf2` | 5979 | Original, unmodified. |
| `HoldMySpot_Competitive_Onepager.pdf` | `b77c03f5249fccf6372ca1204c936cc9463deaaed52bb74305f9f19757995457` | 28597 | Original, unmodified. Derived from the .md above. |
| `HoldMySpot_Agentic_Workflow.pdf` | `c3da8ae46d62242c46d044c8d2d7f44b821ffb15aa834da13221579cae6e19df` | 39969 | Original, unmodified. Submitted with the application. |

## Transcription caveat, HoldMySpot_WhatsApp_Integration_Path.md

This document reached the session as pasted text, not as an uploaded file. No original file exists
in this session to move. The staged copy is a Claude transcription of the text King B supplied.

The hash pins what CC receives. It does NOT establish fidelity to King B's original, because there
is no original here to diff against. Two acceptable resolutions, King B's choice:

1. He supplies the original file, it replaces this one, and the manifest hash is reissued. Preferred.
2. He reads the staged copy against his original and confirms it matches. The manifest is then
   annotated with his confirmation and the transcription status stays recorded.

Until one of those happens, this file carries the transcription flag and no downstream document may
cite it as an original source.

## Not in this set

- `hold-my-spot-mockups.html`. Confirmed absent per P0-F2, whole-repo sweep, zero HTML files in the
  repo. Disposition under seal card item 12: not a build dependency, no rebuild during the sprint,
  Data Room only if a copy surfaces.
- The Claude project instructions. These govern how Claude operates in this project. They are not a
  realm grounding document and do not belong in the repo.

## Placement

All seven files land under `docs/` at the repo root. One forward-only commit, no amend.

`docs/` is not gitignored under the current `.gitignore` (report §6.1), so these files become
tracked and will push. That is intended, and it is why item 22 gates this.

## Build-relevant subset

If King B prefers a narrower first landing, the minimum set for Phase 2 to be specified honestly is
the prototype, the business plan handoff, and the BUILD handoff. The WhatsApp path document joins
that minimum, since Phase 5 is specified against it and the transport decision must live in the
repo rather than only in chat. The two one-pager files and the workflow diagram are Data Room
material and can follow later without blocking anything.

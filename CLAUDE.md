# Hold My Spot, project instructions
Consumes: kingb-harness (via /plugin marketplace add). Global King B doctrine applies.

Realm: holdmyspot

> **Registration status (observed 2026-08-04, evidence `HMS-P0-MAPPING-REPORT.md` b01ef89e):** the `holdmyspot` realm is **half registered**.
> The harness valid-realm list is sealed: merged at `96fd9649`, released in kingb-harness 0.7.0,
> active at user scope, with `holdmyspot` present in both shipped lists. The Igris realm registry
> is not: zero occurrences in the live `realm-config.json`, established by negative proof at
> Phase 0. Whether `realm-memory-sync` writes, refuses on the Igris half, or refuses on the
> separately recorded gbrain supervisor state is not established, because determining it requires
> invoking the skill, which writes. Until the Igris partition exists, no memory carries between
> CC sessions and no phase spec may assume it does.
> Refresh: `HMS-P0-MAPPING-REPORT.md` §8A.7 records the commands that re-derive this.

## Project facts
- Stack: **ratified and landed 2026-08-13**, by the commit that carries this line. pnpm 11.10.0 and
  Node 24.15.0 pinned in `engines` and `.nvmrc`, TypeScript only with `erasableSyntaxOnly`,
  PostgreSQL 18 local, plain SQL migrations, Node's built-in test runner, zero test dependencies.
  **Deploy target and hosts: still none.** Railway and Netlify are named in the spec as targets;
  nothing is deployed and Phase 5 owns that. Refresh: `package.json` and `tsconfig.json` are the
  primary artifacts, and `git log -1 --format=%h -- CLAUDE.md` gives the commit that landed this.
- Architecture: **NOT sealed** as of 2026-08-13. `HMS-KS-002` reached v4 and was gated NOT SAFE TO
  SEAL, 3 CRITICAL, 7 HIGH, 5 MEDIUM, 1 LOW. The code in `src/` and `db/` was written against that
  unsealed v4. **Do not read the presence of code as a ratified architecture.** One gate finding,
  X7, is still undispositioned. Refresh: `HMS-KS-002-v4_GATE_FINDINGS_narrowed.md`,
  `sha256:95d097405932512ab495bbfe670eea837ea3181d04f4b01f9feac7324dc65ce4`.
- Product brief: **supplied.** `docs/hold-my-spot-business-plan-handoff.md`, landed at `0ea570e`,
  ruled the brief of record in HMS-RR-001. Six further grounding documents sit alongside it in
  `docs/`, each hashed in `docs/GROUNDING_MANIFEST.md`. Do not invent product copy, positioning,
  or features. Read the brief. Verify a document against the manifest before citing it as an
  original source: one of the seven is a transcription and is flagged there as such.
- Remote: `blaisepl54-byte/hold-my-spot`. **PRIVATE, and must stay private.** Real contact data is
  permanent in pushed history from `0ea570e`, so this repo cannot be made public without a sealed
  one-time history-rewrite exception from King B, which collides with forward-only and has not been
  granted. Verified private at `a8ae6ed`.

## Gating, per-project lightened set (THE authoritative location)
- **Self-merge/lightened set: NONE ratified** as of `4d7aff4`. No charter is in force for this repo. The global
  default therefore applies in full: never auto-commit, auto-push, or auto-merge. Stage the change,
  propose the message, wait for King B's explicit go. A lightened set only exists once King B
  ratifies one here, in this file.
- Always escalate: prod migration · deploy · auth/secrets/env/flags/DNS · live money rails ·
  destructive ops · public-surface changes · out-of-charter scope.
  Gating is **per-surface**: one authorization never cascades to another surface.
- Value invariants: **none defined yet** as of `4d7aff4`. No money, auth, or real-value path exists
  in this repo. This line rots when a real-value path lands; update it in the same commit.
  Define them here before the first such path is written, not after.

## Project-specific agents/skills (override harness by-name)
- None as of `4d7aff4`. No `.claude/` overrides exist, so the harness surface
  (`kingb-harness:verifier`, `realm-memory-sync`, `humanizer`, the safety hooks) applies unmodified.
- **Except that `kingb-harness:verifier` does not bind.** Finding P0-F10 established that a
  namespaced dispatch to that name silently falls through to another agent, proven behaviorally on
  differential tool grants. Do not dispatch to it, and never record it as a reviewer.
- Verifier rounds run as a **fresh CC session in clean context** acting as reviewer, until F10 is
  fixed in the kingb-harness realm.
- A reviewer identity is written into a closing line only where positive evidence establishes that
  the named agent served the call (A4.2). `UNRESOLVED` is permitted and honest. A requested name is
  not evidence of the agent that answered.
- **F11:** the shipped kingb-harness 0.7.0 verifier declares `model: sonnet` against a ratified Opus
  floor. Any dispatch that does not explicitly raise the tier gets Sonnet. F11 is fixed before or
  with F10, never after.

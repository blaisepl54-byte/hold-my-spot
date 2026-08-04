# Hold My Spot — project instructions
Consumes: kingb-harness (via /plugin marketplace add). Global King B doctrine applies.

Realm: holdmyspot

> **Registration status (2026-08-04):** the `holdmyspot` realm is **staged, not sealed**. It is not
> yet in the harness valid-realm list (kingb-harness PR, staged) nor in the Igris realm registry
> (commander-igris PR, staged). Until both are sealed, `realm-memory-sync` from this repo will
> correctly refuse to write, and that refusal is correct behavior — not a defect.

## Project facts
- Stack / deploy / hosts: **none chosen yet.** No code, no build, no deploy target, no hosts.
- Product brief: **not supplied.** Do not invent product copy, positioning, or features — write
  the brief into `README.md` only from King B's own words.
- Remote: `blaisepl54-byte/hold-my-spot`.

## Gating — per-project lightened set (THE authoritative location)
- **Self-merge/lightened set: NONE ratified.** No charter is in force for this repo. The global
  default therefore applies in full: never auto-commit, auto-push, or auto-merge. Stage the change,
  propose the message, wait for King B's explicit go. A lightened set only exists once King B
  ratifies one here, in this file.
- Always escalate: prod migration · deploy · auth/secrets/env/flags/DNS · live money rails ·
  destructive ops · public-surface changes · out-of-charter scope.
  Gating is **per-surface**: one authorization never cascades to another surface.
- Value invariants: **none defined yet** — no money, auth, or real-value path exists in this repo.
  Define them here before the first such path is written, not after.

## Project-specific agents/skills (override harness by-name)
- None. The harness surface (`kingb-harness:verifier`, `realm-memory-sync`, `humanizer`, the
  safety hooks) applies unmodified.

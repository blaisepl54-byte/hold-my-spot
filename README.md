# Hold My Spot

> **Status: scaffold plus grounding, as of `4d7aff4`.** This repository was created on 2026-08-04 as
> a realm scaffold. The product brief has since been supplied and is tracked at
> `docs/hold-my-spot-business-plan-handoff.md`, ruled the brief of record in HMS-RR-001. This README
> still carries no product description, positioning, or feature copy, because that copy belongs in
> the brief rather than duplicated here, where the duplicate would drift out of step with it.
> Read `docs/` for the product.

## What exists as of `4d7aff4`

- `README.md`, this file.
- `CLAUDE.md`, project instructions. Carries the `Realm:` tag, the gating contract, and the
  `Consumes: kingb-harness` declaration.
- `.gitignore`
- `.gitattributes`, pinning `docs/**` line endings so the grounding hashes verify on any clone.
- `docs/`, the grounding set: seven documents plus `GROUNDING_MANIFEST.md`, each hashed there.
- `HMS-P0-MAPPING-REPORT.md`, the Phase 0 read-only mapping, reviewed and remediated.
- No stack has been chosen and no product code has been written. 13 files tracked at `4d7aff4`.

## Harness

This repo consumes the shared **kingb-harness** plugin (doctrine, safety hooks, governance).
See `CLAUDE.md` for the gating contract that governs work here.

## Realm registration

`Realm: holdmyspot` (see `CLAUDE.md`). Registration is **half complete** as of `4d7aff4`: the
kingb-harness valid-realm list is sealed (merged `96fd9649`, released 0.7.0), the Igris realm
registry is not (zero entries, negative proof at Phase 0). Whether `realm-memory-sync` writes or
refuses is not established, because determining it requires invoking the skill, which writes. Until
the Igris partition exists, no memory carries between CC sessions.

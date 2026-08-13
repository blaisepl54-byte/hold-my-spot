# Hold My Spot

> **Status: Phase 1a scaffold plus grounding, as of 2026-08-13.** This repository was created on 2026-08-04 as
> a realm scaffold. The product brief has since been supplied and is tracked at
> `docs/hold-my-spot-business-plan-handoff.md`, ruled the brief of record in HMS-RR-001. This README
> still carries no product description, positioning, or feature copy, because that copy belongs in
> the brief rather than duplicated here, where the duplicate would drift out of step with it.
> Read `docs/` for the product.

## What exists as of 2026-08-13

- `README.md`, this file.
- `CLAUDE.md`, project instructions. Carries the `Realm:` tag, the gating contract, and the
  `Consumes: kingb-harness` declaration.
- `.gitignore`
- `.gitattributes`, pinning `docs/**` line endings so the grounding hashes verify on any clone.
- `docs/`, the grounding set: seven documents plus `GROUNDING_MANIFEST.md`, each hashed there.
- `HMS-P0-MAPPING-REPORT.md`, the Phase 0 read-only mapping, reviewed and remediated.
- `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `tsconfig.json`, the pinned toolchain.
- `src/`, the Phase 1a skeleton: four boundary markers that throw when called, plus three live
  modules, a read pool, a write pool, and a health route.
- `db/`, the migration runner and `001_schema_migrations.sql`, the migration ledger table only.
- **No queue logic, no agents, and no product route exist.** The markers are enforcement surfaces
  for the boundary test, not implementations. 40 files tracked, count derived by `git ls-files`
  at the commit carrying this line.
- **The architecture is not sealed.** `HMS-KS-002` v4 was gated NOT SAFE TO SEAL and the code here
  was written against it. See `CLAUDE.md` under Project facts.

## Harness

This repo consumes the shared **kingb-harness** plugin (doctrine, safety hooks, governance).
See `CLAUDE.md` for the gating contract that governs work here.

## Realm registration

`Realm: holdmyspot` (see `CLAUDE.md`). Registration is **half complete** as of `4d7aff4`: the
kingb-harness valid-realm list is sealed (merged `96fd9649`, released 0.7.0), the Igris realm
registry is not (zero entries, negative proof at Phase 0). Whether `realm-memory-sync` writes or
refuses is not established, because determining it requires invoking the skill, which writes. Until
the Igris partition exists, no memory carries between CC sessions.

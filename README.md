# Hold My Spot

> **Status: scaffold only.** This repository was created on 2026-08-04 as a realm scaffold. The
> product brief has not been supplied yet, so this README deliberately contains **no product
> description, positioning, or feature copy** — inventing any would put unratified claims into the
> record. Replace this section with King B's brief when it lands.

## What exists right now

- `README.md` — this file.
- `CLAUDE.md` — project instructions. Carries the `Realm:` tag, the gating contract, and the
  `Consumes: kingb-harness` declaration.
- `.gitignore`
- Nothing else. No stack has been chosen, no code has been written.

## Harness

This repo consumes the shared **kingb-harness** plugin (doctrine, safety hooks, governance).
See `CLAUDE.md` for the gating contract that governs work here.

## Realm registration

`Realm: holdmyspot` (see `CLAUDE.md`). Registration across the harness valid-realm list and the
Igris realm registry is **staged and pending King B's seals** as of 2026-08-04 — until both land,
`realm-memory-sync` from this repo will correctly refuse to write.

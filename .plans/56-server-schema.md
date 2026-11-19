# #56 Build normalized D1 schema and server contracts

## Summary

Define the complete v1 D1 persistence model from specification sections 5 and 7, including runtime-validated
row contracts and a migration that can be applied to local D1.

## Acceptance criteria

- [x] Every in-scope prototype field and invariant has a Drizzle column/check/index/FK disposition.
- [x] Identity, membership, billing, trial, deletion, MCP, synchronization, and tombstone tables exist.
- [x] The initial migration applies cleanly to local D1 and enforces representative constraints.
- [x] Effect-to-row round trips preserve every mapped field without unchecked casts.

## TODOs

- [x] Add shared Effect schemas, tagged persistence errors, and checked JSON row codecs.
- [x] Define and export the normalized identity, domain, taxonomy, billing, MCP, and sync tables.
- [x] Generate and locally apply the additive migration; add schema and round-trip tests.

## Notes

- Canonical model: `docs/architecture/local-first-rewrite-spec.md` sections 5 and 7.
- Prototype baseline: `74a12ec38f6c297d1a6adbf596234c45212bac11`.
- D1 enforces foreign keys during migrations; migrations must remain forward-only.
- The migration creates 52 normalized tables and applied successfully to a fresh local D1 state.
- Validation: `pnpm test:unit`, `pnpm test:d1-schema`, `pnpm check`, `pnpm lint`, and `git diff --check`.

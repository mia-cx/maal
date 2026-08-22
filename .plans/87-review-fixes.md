# #87 Fix substantive PR #69 review findings

## Summary

Repair five release-blocking correctness gaps in sync convergence, backfill progress, server mutation
validation, cached billing capability expiry, and the active pnpm security override.

## Acceptance criteria

- [x] Rejected user and household mutations reveal the authoritative remote aggregate after a masked pull.
- [x] Oversized user and household backfill records reach a persisted terminal result without blocking later records.
- [x] User and household sync reject invalid conflict groups and deletion semantics before any repository write.
- [x] Expired cached paid capabilities cannot start sync, and launch refresh does not contact remote services for free households.
- [x] The cookie override lives in pnpm's active workspace configuration and survives lockfile regeneration.
- [x] Focused regression and bounded full validation gates pass without changing the Drizzle chain or taxonomy seed.

## Test seams

The issue confirms these public seams: user and household sync coordinators, their Dexie records and transport
contracts, D1 sync repositories, the billing launch-refresh decision, and pnpm's workspace configuration.
Tests exercise those interfaces without reaching into private helpers.

## TODOs

- [x] Reconcile authoritative user and household state after rejected masked mutations.
- [x] Persist oversized backfill outcomes and let later user and household records progress.
- [x] Validate user and household mutation conflict and deletion semantics before repository writes.
- [x] Expire cached capabilities locally and restrict launch refresh to previously paid projections.
- [x] Move the cookie override into pnpm's workspace configuration.
- [x] Run focused D1/schema gates, check, lint, and one bounded full validation.

## Notes

- Base: `1314d796dc71a9e3749cdf16202d663c96b1f1d5`.
- Preserve `drizzle/0000_rewrite_baseline.sql`, `drizzle/0001_global_taxonomy_seed.sql`, and the canonical 40-unit/184-alias seed byte-for-byte.
- No remote D1, WorkOS, Stripe, Cloudflare, deployment, issue, or PR mutation runs in this worktree.
- Vitest and Playwright stay at four workers or fewer. Test suites never overlap.
- Rejected-receipt slice: 2 files / 27 tests passed. Masked remote snapshots and receipt state now commit atomically.
- Oversized-backfill slice: 2 files / 29 tests passed. A single request may use the Worker's 1 MiB bound; larger records get a persisted rejection and advance the checkpoint.
- Server-validation slice: 2 files / 33 tests passed. Every batch validates entity conflict groups and operation/deletedAt agreement before its first commit.
- Capability-expiry slice: 3 files / 39 tests passed. Active and grace projections stop at validUntil; launch refresh scans only stale or expired households with prior Stripe state.
- pnpm override slice: 1 file / 2 tests passed. `pnpm install --lockfile-only` retained the cookie override without the ignored-package-field warning.
- Final gates: the fresh D1 schema and seed chain passed; 6 focused files / 54 tests passed; check and lint passed; `pnpm validate` passed with 63 unit files / 342 tests, a 189,361-byte initial gzip entry, and 22 Playwright tests.
- The fresh Drizzle baseline, taxonomy seed migration, and TypeScript taxonomy seed have no diff from the ticket base.

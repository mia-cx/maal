## Parent PRD

#55

## What to build

Implement household meal/check-in synchronization, lapse/resubscription reconciliation, slow prioritized backfill, retention floors, and membership revocation from spec §8.

## Acceptance criteria

- [ ] Household authorization checks current WorkOS projection and capability before domain D1 access.
- [ ] Pull/reapply/push/pull converges after divergent local-free use.
- [ ] Backfill obeys 25 aggregates, 256 KiB, 30 seconds, foreground, Save-Data, priority, and checkpoints.
- [ ] Expired cursors bootstrap; acknowledged missing IDs and tombstones cannot resurrect.

## TODOs

- [x] Add versioned household sync contracts and complete aggregate descriptors.
- [x] Add a per-auth-slot household coordinator with paid-only networking, leases, convergence, and prioritized slow backfill.
- [x] Add current WorkOS membership and paid/grace authorization for the requested household audience.
- [x] Add normalized D1 household commits, pull/bootstrap, conflict ordering, receipts, tombstones, and retention.
- [x] Prove two-member convergence, lapse/resubscribe, stale backfill, cursor expiry, zero unpaid requests, and actor isolation.
- [x] Run focused tests, `pnpm validate`, and `pnpm test:d1-schema`; record evidence.

## Notes

- The household content audience contains meals, focused check-ins, household taxonomy/preferences, and household appliances.
- WorkOS/D1 remains authoritative for household identity, membership, billing, and deletion lifecycle projections.
- The local `Household` record has UI/lifecycle fields that the normalized D1 household table does not accept from clients, so this ticket does not upload that aggregate.
- Service-worker domain ownership remains out of scope; the foreground coordinator is the correctness path.
- Validation on 2026-08-21: focused household sync tests 10/10, full test suite 33 files and 171/171 tests, Playwright 7/7, `pnpm validate`, and `pnpm test:d1-schema` all passed. A post-validation static review added the entity-key bootstrap ordering regression to the focused count.

## Blocked by

Dashboard/meal, server schema, user-sync, and auth-slot slices.

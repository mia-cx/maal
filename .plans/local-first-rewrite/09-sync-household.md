## Parent PRD

#55

## What to build

Implement household meal/check-in synchronization, lapse/resubscription reconciliation, slow prioritized backfill, retention floors, and membership revocation from spec §8.

## Acceptance criteria

- [ ] Household authorization checks current WorkOS projection and capability before domain D1 access.
- [ ] Pull/reapply/push/pull converges after divergent local-free use.
- [ ] Backfill obeys 25 aggregates, 256 KiB, 30 seconds, foreground, Save-Data, priority, and checkpoints.
- [ ] Expired cursors bootstrap; acknowledged missing IDs and tombstones cannot resurrect.

## Blocked by

Dashboard/meal, server schema, user-sync, and auth-slot slices.

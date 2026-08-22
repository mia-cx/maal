# #76 Schedule retention and destructive purge jobs

## Summary

Run recipe expiry from the local foreground without cloud access. Run sync retention and expired household
purges from a configured Cloudflare scheduled handler using D1 server time, bounded work, and structured logs.

## Acceptance criteria

- [ ] Local deleted-recipe expiry runs safely in the foreground without cloud access and preserves the revive window.
- [ ] D1 sync receipt, change, and tombstone retention runs from configured Worker schedules using server time, bounded batches, idempotency, and observability.
- [ ] Household purge runs only after cancellation/refund and the 30-day recovery window, with retry-safe bounded batches.
- [ ] Explicit permanent recipe deletion and household purge remain distinct from ordinary tombstones.
- [ ] Tests prove retention floors prevent resurrection and scheduled handlers do not scan or delete outside their target scope.

## TODOs

- [ ] Add bounded foreground recipe retention for retained local auth slots and keep unacknowledged purge tombstones.
- [ ] Add scoped, bounded D1 sync retention with retained-floor updates and a scheduled Worker entrypoint.
- [ ] Add claimed, bounded, retry-safe household purge after the recovery window.
- [ ] Run focused validation and record the serialized full-validation handoff.

## Notes

- The scheduled job reads one canonical UTC instant from D1. It never accepts a client cleanup timestamp.
- Retention updates only scopes whose change rows were deleted. A cursor below the new floor must bootstrap.
- Household purge keeps trial claims, deletion requests, and billing audit facts. It removes household content and sync payloads.
- Local tombstones may outlive one year when their delete mutation has not reached D1. This prevents a later sync from losing the deletion intent.

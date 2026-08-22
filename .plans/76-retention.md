# #76 Schedule retention and destructive purge jobs

## Summary

Run recipe expiry from the local foreground without cloud access. Run sync retention and expired household
purges from a configured Cloudflare scheduled handler using D1 server time, bounded work, and structured logs.

## Acceptance criteria

- [x] Local deleted-recipe expiry runs safely in the foreground without cloud access and preserves the revive window.
- [x] D1 sync receipt, change, and tombstone retention runs from configured Worker schedules using server time, bounded batches, idempotency, and observability.
- [x] Household purge runs only after cancellation/refund and the 30-day recovery window, with retry-safe bounded batches.
- [x] Explicit permanent recipe deletion and household purge remain distinct from ordinary tombstones.
- [x] Tests prove retention floors prevent resurrection and scheduled handlers do not scan or delete outside their target scope.

## TODOs

- [x] Add bounded foreground recipe retention for retained local auth slots and keep unacknowledged purge tombstones.
- [x] Add scoped, bounded D1 sync retention with retained-floor updates and a scheduled Worker entrypoint.
- [x] Add claimed, bounded, retry-safe household purge after the recovery window.
- [x] Run focused validation and record the serialized full-validation handoff.

## Notes

- The scheduled job reads one canonical UTC instant from D1. It never accepts a client cleanup timestamp.
- Retention updates only scopes whose change rows were deleted. A cursor below the new floor must bootstrap.
- Household purge keeps trial claims, deletion requests, and billing audit facts. It removes household content and sync payloads.
- Local tombstones may outlive one year when their delete mutation has not reached D1. This prevents a later sync from losing the deletion intent.
- Focused local validation: `pnpm exec vitest run tests/unit/recipes.spec.ts` (7 tests passed).
- Focused D1 validation: scheduled retention plus user/household repositories passed 12 tests.
- `pnpm gen` accepts the custom fetch/scheduled Worker entrypoint and configured UTC cron.
- Household purge validation: focused retention/billing tests passed 9 tests; `pnpm check` reports 0 diagnostics.
- The existing `requested` deletion state is reserved as the post-window purge claim with safe code `purge_claimed`; this avoids a destructive schema rebuild and closes the recovery race before WorkOS deletion.
- Full validation passed: formatting/lint, generated types, Svelte diagnostics, 277 unit/browser tests, production build, performance budget, and 13 end-to-end tests.
- `pnpm test:d1-schema` passed, and Wrangler's dry-run bundle accepted the custom fetch/scheduled entrypoint and bindings.

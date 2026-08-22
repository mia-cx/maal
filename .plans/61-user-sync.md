# #61 Synchronize user recipes and taxonomy

## Summary

Add the paid, foreground user-scope synchronization path for complete recipe aggregates and user-owned
taxonomy/preferences. The UI remains Dexie-only; the coordinator is the sole routine domain network client.

## Acceptance criteria

- [x] Mutation receipts, idempotency, cursors, leases, and atomic complete-aggregate application are tested.
- [x] Live writes use D1 sequence while historical backfill uses the one-hour event-time threshold.
- [x] Any active/grace household membership enables the user audience locally and remotely.
- [x] Routine free use performs no sync Worker or D1 requests.
- [x] Retry, offline, reauthentication, capability loss, expired cursors, and recipe retention are covered.

## TODOs

- [x] Define versioned Effect sync contracts, user-entity registry, and atomic client application primitives.
- [x] Implement the foreground per-auth-slot coordinator, capability gate, retry policy, and bounded backfill.
- [x] Implement authenticated user-scope routes, capability authorization, and D1 synchronization repository.
- [x] Add protocol, coordinator, reconciliation, idempotency, retention, and cost-proof tests.
- [x] Run focused and full validation and record the final proof.

## Notes

- Server billing is consumed through a narrow capability interface so #65 can replace its projection without
  changing the sync protocol.
- Household meals/check-ins and household taxonomy stay outside this issue and remain #57.
- Validation: `pnpm check`, `pnpm lint`, `pnpm test:unit` (127 tests), `pnpm test:d1-schema`,
  focused sync/D1/schema tests (27 tests), and `pnpm build` pass.
- Integration currently owns migration `0001`; regenerate this branch's sync migration as `0002` after rebase.

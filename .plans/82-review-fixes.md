# #82 Resolve independent review findings for the local-first rewrite

## Summary

Close all eleven independent review findings without changing the approved prototype UI. The work repairs
bootstrap retention and ordering, local mutation coverage, fresh-device discovery, live WorkOS authorization,
deletion-state denial, profile removal, and portable import reconciliation.

## Acceptance criteria

- [x] User and household bootstrap stay complete after change-log pruning.
- [x] Entity-key bootstrap pages accept non-monotonic commit sequences while pull pages stay ordered.
- [x] Household settings, each appliance, meal status, and check-ins enqueue supported atomic mutations.
- [x] Fresh authentication projects households, memberships, and billing capability before sync starts.
- [x] Billing and sync requests intersect D1 membership data with live WorkOS identity, role, and permissions.
- [x] Deletion, refund, recoverable, and purge-pending households cannot sync.
- [x] Removing one profile preserves check-ins in households retained by another local profile.
- [x] Portable import protects global taxonomy seed rows and stamps every recipe or meal conflict group.
- [x] Populated upgrades preserve required meal ownership, repair historical check-in scope, and expose
      unresolvable rows through supported recovery export and restore operations.
- [x] Status-only check-in gestures converge after a planned cook leaves the household.
- [x] A recovered household stays sync-disabled until a replacement subscription distinct from the canceled one is projected.
- [x] Household and user mutation batches validate completely before their first repository write.
- [x] Focused D1, Worker, local, browser, and full validation gates pass.

## Test seams

The issue and review establish these public seams: D1 sync repositories, sync page appliers, typed Dexie
commands and outbox records, auth-slot projection, Worker billing/sync authorization, local profile removal,
and portable archive import. Regression tests exercise behavior only through those existing interfaces.

## TODOs

- [x] Make pruned-log bootstrap self-contained and fix user bootstrap page ordering.
- [x] Emit supported household settings, appliance, meal-status, and check-in mutations atomically.
- [x] Discover remote household state on a fresh device and harden live WorkOS authorization and deletion denial.
- [x] Preserve retained check-ins and harden portable taxonomy and aggregate import.
- [x] Close populated-migration, convergence, recovered-subscription, and batch-atomicity merger blockers.
- [x] Run focused local, D1, Worker, browser, prototype-preservation, and full validation gates.

## Notes

- Base: `c34da8e25ef9688f72abdad6904e4bc827a1853e`.
- Prototype authority: `main@74a12ec38f6c297d1a6adbf596234c45212bac11`.
- No browser MCP and no UI redesign.
- Bootstrap slice: 26 focused tests passed; the complete D1 migration chain passed.
- Local mutation slice: 43 focused tests passed; D1 migration and Svelte checks passed.
- Discovery/authentication slice: 40 focused tests passed; Svelte checks passed.
- Profile/portability slice: 15 focused tests passed.
- Merger follow-up: 55 focused migration, schema, D1, service, discovery, and billing tests passed; Drizzle
  generation reported no schema drift and the complete D1 migration chain passed.
- Final gates: D1 migration chain passed; 10 protected prototype files matched byte-for-byte; full
  `pnpm validate` passed with 60 unit files / 319 tests, production build and budget, and 22 Playwright
  tests.

# #82 Resolve independent review findings for the local-first rewrite

## Summary

Close all eleven independent review findings without changing the approved prototype UI. The work repairs
bootstrap retention and ordering, local mutation coverage, fresh-device discovery, live WorkOS authorization,
deletion-state denial, profile removal, and portable import reconciliation.

## Acceptance criteria

- [ ] User and household bootstrap stay complete after change-log pruning.
- [ ] Entity-key bootstrap pages accept non-monotonic commit sequences while pull pages stay ordered.
- [ ] Household settings, each appliance, meal status, and check-ins enqueue supported atomic mutations.
- [ ] Fresh authentication projects households, memberships, and billing capability before sync starts.
- [ ] Billing and sync requests intersect D1 membership data with live WorkOS identity, role, and permissions.
- [ ] Deletion, refund, recoverable, and purge-pending households cannot sync.
- [ ] Removing one profile preserves check-ins in households retained by another local profile.
- [ ] Portable import protects global taxonomy seed rows and stamps every recipe or meal conflict group.
- [ ] Focused D1, Worker, local, browser, and full validation gates pass.

## Test seams

The issue and review establish these public seams: D1 sync repositories, sync page appliers, typed Dexie
commands and outbox records, auth-slot projection, Worker billing/sync authorization, local profile removal,
and portable archive import. Regression tests exercise behavior only through those existing interfaces.

## TODOs

- [x] Make pruned-log bootstrap self-contained and fix user bootstrap page ordering.
- [x] Emit supported household settings, appliance, meal-status, and check-in mutations atomically.
- [ ] Discover remote household state on a fresh device and harden live WorkOS authorization and deletion denial.
- [ ] Preserve retained check-ins and harden portable taxonomy and aggregate import.
- [ ] Run focused local, D1, Worker, browser, prototype-preservation, and full validation gates.

## Notes

- Base: `c34da8e25ef9688f72abdad6904e4bc827a1853e`.
- Prototype authority: `main@74a12ec38f6c297d1a6adbf596234c45212bac11`.
- No browser MCP and no UI redesign.
- Bootstrap slice: 26 focused tests passed; the complete D1 migration chain passed.
- Local mutation slice: 43 focused tests passed; D1 migration and Svelte checks passed.

## Parent PRD

#55

## What to build

Implement portable ZIP import/export, collision/remap behavior, local deletion recovery, service-worker shell caching, coordinated updates, offline reopen, and recovery UI from spec §§9–10.

## Acceptance criteria

- [ ] Users export everything visible and no auth/sync implementation secrets.
- [ ] Restore, merge, replace, and import-as-copy preserve ownership and references.
- [ ] Offline reopen and multi-tab update behavior never risks committed Dexie data.
- [ ] Quota, corruption, and migration failures provide non-destructive recovery.

## Blocked by

Local runtime, recipe, and dashboard/meal slices.

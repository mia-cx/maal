## Parent PRD

#55

## What to build

Implement the shared Effect contract primitives, one shared device Dexie database, transaction-safe command/outbox boundary, live-query adapters, migrations, quota handling, and recovery shell from spec §§2, 3, and 6.

## Acceptance criteria

- [ ] One `maal-v1:<environment>` database supports logically scoped profiles and households.
- [ ] Typed commands atomically update aggregates, conflict clocks, and outbox entries.
- [ ] UI-facing adapters expose decoded live-query values and never hydrate from HTTP.
- [ ] Forward migrations, quota aborts, multi-tab leases, and explicit recovery are tested.

## Blocked by

None - can start immediately.

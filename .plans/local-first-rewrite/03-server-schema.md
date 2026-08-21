## Parent PRD

#55

## What to build

Implement the normalized Drizzle/D1 domain, identity projection, billing, MCP, and synchronization schema plus migrations and exact SQLite constraints from spec §§5 and 7.

## Acceptance criteria

- [ ] Every in-scope prototype field and invariant has a Drizzle column/check/index/FK disposition.
- [ ] New membership, billing, trial, deletion, MCP, sync-version, change, device, scope, and tombstone tables exist.
- [ ] Migrations are additive, tested against local D1, and reflected in schema exports.
- [ ] Effect-to-row round trips preserve all fields without unchecked casts.

## Blocked by

None - can start immediately.

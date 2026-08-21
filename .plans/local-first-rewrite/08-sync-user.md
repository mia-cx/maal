## Parent PRD

#55

## What to build

Implement authenticated push/pull/bootstrap/backfill for user-owned recipes, user taxonomy, and preferences using the D1 sequence and event-time rules in spec §§7.5 and 8.

## Acceptance criteria

- [ ] Mutation receipts, idempotency, cursors, leases, and complete-aggregate application are tested.
- [ ] Live conflicts use D1 sequence; historical contenders over one hour apart use original UTC edit time.
- [ ] Membership in any paid/grace household enables the user recipe audience.
- [ ] Free profiles do not poll or touch D1 for routine content use.

## Blocked by

Local runtime, server schema, taxonomy, recipe, and auth-slot slices.

# `unit_household_entries`

`unit_household_entries` stores household-scoped provisional unit identities.

Rows are active immediately for that household. They let a shared household vocabulary represent units whose canonical global `units` row does not exist yet.

## Table

```txt
unit_household_entries
- id                  // index-friendly primary key
- householdId         // WorkOS organization / household id
- canonicalLabel      // household canonical label for the unit
- baseUnitId          // references units.id
- toBaseFactor        // numeric multiplier from this unit to base unit
- toBaseOffset        // numeric offset after multiplication; usually 0
- adoptionStatus      // pending_review | accepted | rejected
- createdAt
- updatedAt
```

## Columns

### `baseUnitId`

Reference to the canonical global base unit used for conversion. For non-convertible count/package units, moderation can promote the provisional unit into `units` with itself as the base unit.

### `adoptionStatus`

Tracks whether this scoped unit has been reviewed for possible global adoption.

- `pending_review` — active for the household and waiting for moderation
- `accepted` — accepted into global taxonomy or intentionally mapped to an existing global unit
- `rejected` — remains household-local but should not keep showing up in moderator queues

This is not an activation status. Scoped unit entries are active immediately for their scope regardless of adoption status.

## Constraints

At most one household unit entry per normalized label:

```ts
uniqueIndex('unit_household_entries_label_unique').on(table.householdId, table.canonicalLabel);
```

`baseUnitId` references `units.id`.

## Reasoning

Household entries allow shared planning vocabulary before global unit taxonomy catches up. They are local identity rows with conversion math, not aliases. Do not add scope columns here; the table already provides household scope.

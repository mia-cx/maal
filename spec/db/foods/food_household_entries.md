# `food_household_entries`

`food_household_entries` stores household-scoped provisional food identities.

Rows are active immediately for that household. They let a shared household vocabulary represent ingredients whose canonical global `foods` row does not exist yet.

## Table

```txt
food_household_entries
- id                         // index-friendly primary key
- householdId                // WorkOS organization / household id
- canonicalLabel             // household canonical label for the food
- defaultMeasureUnitId?      // references units.id
- defaultMeasureBaseUnitId?  // denormalized from units.baseUnitId for defaultMeasureUnitId
- adoptionStatus             // pending_review | accepted | rejected
- createdAt
- updatedAt
```

## Columns

### `adoptionStatus`

Tracks whether this scoped food has been reviewed for possible global adoption.

- `pending_review` — active for the household and waiting for moderation
- `accepted` — accepted into global taxonomy or intentionally mapped to an existing global food
- `rejected` — remains household-local but should not keep showing up in moderator queues

This is not an activation status. Scoped food entries are active immediately for their scope regardless of adoption status.

## Constraints

At most one household food entry per normalized label:

```ts
uniqueIndex('food_household_entries_label_unique').on(table.householdId, table.canonicalLabel);
```

Default measure units use a composite FK when present:

```ts
foreignKey({
	columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
	foreignColumns: [units.id, units.baseUnitId],
	name: 'food_household_entries_default_measure_unit_base_fk'
});
```

Default unit columns should be both null or both present.

## Reasoning

Household entries allow shared pantry/planning vocabulary before global taxonomy catches up. They are local identity rows, not aliases. Do not add scope columns here; the table already provides household scope.

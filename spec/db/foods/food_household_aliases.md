# `food_household_aliases`

`food_household_aliases` stores household-scoped food aliases for canonical foods.

Rows are active immediately for that WorkOS organization. They are not global taxonomy truth. If a household alias should become global, create a moderation/proposal row separately and merge into `food_aliases` after approval.

## Table

```txt
food_household_aliases
- id                         // index-friendly primary key
- householdId                // WorkOS organization id
- foodId                     // references foods.id
- alias                      // actual alias text
- locale                     // BCP 47 locale, e.g. en-US, en-GB, nl-NL
- sourceDomain?              // optional source-site-specific alias context
- adoptionStatus             // pending_review | accepted | rejected
- defaultMeasureUnitId?      // optional household alias-specific default measure unit
- defaultMeasureBaseUnitId?  // denormalized from units.baseUnitId for defaultMeasureUnitId
```

## Columns

### `adoptionStatus`

Tracks whether this scoped alias has been reviewed for possible global adoption.

- `pending_review` — active for the household and waiting for moderation
- `accepted` — accepted into global taxonomy or intentionally equivalent to an existing global alias
- `rejected` — remains household-local but should not keep showing up in moderator queues

This is not an activation status. Scoped aliases are active immediately for their scope regardless of adoption status.

## Constraints

`foodId` references `foods.id` and cascades on delete.

Alias-specific default measure units use a composite FK when present:

```ts
foreignKey({
	columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
	foreignColumns: [units.id, units.baseUnitId],
	name: 'food_household_aliases_default_measure_unit_base_fk'
});
```

Domain-scoped aliases are for parsing imports, not general display defaults. Display defaults live in `household_food_display_overrides`.

Alias unit columns should be both null or both present.

## Reasoning

The table scope is already the alias scope: household. Household aliases name canonical foods; user/household preferences decide which aliases and units display by default.

# `household_food_display_overrides`

`household_food_display_overrides` stores household overrides for food display behavior.

This table chooses display aliases and optional food-specific display units. It does not change recipe/meal ingredient identity.

## Table

```txt
household_food_display_overrides
- id
- householdId                    // WorkOS organization id
- foodId                         // references foods.id
- locale
- preferredFoodAliasScope?       // global | household
- preferredFoodAliasId?          // id in the scoped food alias table
- preferredMeasureUnitId?        // references units.id
- preferredMeasureBaseUnitId?    // denormalized from units.baseUnitId
- createdAt
- updatedAt
```

## Alias target

`preferredFoodAliasScope` tells the app which alias table contains `preferredFoodAliasId`:

```txt
global    -> food_aliases.id
household -> food_household_aliases.id
```

Household display overrides should not point at user-scoped aliases.

## Constraints

- unique `(householdId, foodId, locale)`
- `foodId` references `foods.id`
- `(preferredMeasureUnitId, preferredMeasureBaseUnitId)` foreign-keys to `units(id, baseUnitId)` when present

Application invariants:

- `preferredFoodAliasScope` and `preferredFoodAliasId` are both null or both present
- selected alias must match `foodId` and `locale`
- if scope is `household`, selected alias must belong to `householdId`
- preferred unit columns are both null or both present

SQLite/D1 cannot enforce a foreign key that points at one of several alias tables. Enforce the scoped alias lookup at the application boundary unless a future unified alias table is introduced.

## Reasoning

Use `preferredFoodAliasScope` + `preferredFoodAliasId` when choosing a label, because the preferred alias may be global or household-scoped.

Use `preferredMeasureUnitId` when choosing a unit identity, because unit identity and unit label are separate concerns.

Do not populate this during household creation unless the household actually overrides locale/default behavior.

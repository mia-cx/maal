# `user_food_display_overrides`

`user_food_display_overrides` stores user overrides for food display behavior.

This table chooses display aliases and optional food-specific display units. It does not change recipe/meal ingredient identity.

## Table

```txt
user_food_display_overrides
- id
- workosUserId
- foodId                         // references foods.id
- locale
- preferredFoodAliasScope?       // global | household | user
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
user      -> food_user_aliases.id
```

This is a display override-level polymorphic reference. The alias tables themselves do not need scope columns because their table names already define their scope.

## Constraints

- unique `(workosUserId, foodId, locale)`
- `foodId` references `foods.id`
- `(preferredMeasureUnitId, preferredMeasureBaseUnitId)` foreign-keys to `units(id, baseUnitId)` when present

Application invariants:

- `preferredFoodAliasScope` and `preferredFoodAliasId` are both null or both present
- selected alias must match `foodId` and `locale`
- if scope is `user`, selected alias must belong to `workosUserId`
- if scope is `household`, selected alias must belong to the active household
- preferred unit columns are both null or both present

SQLite/D1 cannot enforce a foreign key that points at one of several alias tables. Enforce the scoped alias lookup at the application boundary unless a future unified alias table is introduced.

## Reasoning

Use `preferredFoodAliasScope` + `preferredFoodAliasId` when choosing a label, because the preferred alias may be global, household-scoped, or user-scoped.

Use `preferredMeasureUnitId` when choosing a unit identity, because unit identity and unit label are separate concerns.

Do not populate this during user creation unless the user actually overrides locale/default behavior.

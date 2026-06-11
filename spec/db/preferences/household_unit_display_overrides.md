# `household_unit_display_overrides`

`household_unit_display_overrides` stores household overrides for how a unit family displays.

It can choose the preferred unit identity and, when needed, the preferred alias spelling for that unit.

## Table

```txt
household_unit_display_overrides
- id
- householdId              // WorkOS organization id
- baseUnitId               // unit family, references units.id
- locale
- preferredUnitId          // references units.id
- preferredUnitAliasScope? // global | household
- preferredUnitAliasId?    // id in the scoped unit alias table
- createdAt
- updatedAt
```

## Alias target

`preferredUnitAliasScope` tells the app which alias table contains `preferredUnitAliasId`:

```txt
global    -> unit_aliases.id
household -> unit_household_aliases.id
```

Household display overrides should not point at user-scoped aliases.

## Constraints

- unique `(householdId, baseUnitId, locale)`
- `baseUnitId` references `units.id`
- `(preferredUnitId, baseUnitId)` foreign-keys to `units(id, baseUnitId)`

Application invariants:

- `preferredUnitAliasScope` and `preferredUnitAliasId` are both null or both present
- selected alias must match `preferredUnitId`, `baseUnitId`, and `locale`
- if scope is `household`, selected alias must belong to `householdId`

SQLite/D1 cannot enforce a foreign key that points at one of several alias tables. Enforce the scoped alias lookup at the application boundary unless a future unified alias table is introduced.

## Preferred unit vs preferred alias

Use `preferredUnitId` to answer “cups instead of milliliters.”

Use `preferredUnitAliasScope` + `preferredUnitAliasId` only when the household explicitly chooses label spelling, e.g. `tbsp` instead of `tablespoon`.

Do not populate this during household creation unless the household actually overrides the default.

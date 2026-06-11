# `user_unit_display_overrides`

`user_unit_display_overrides` stores user overrides for how a unit family displays.

It can choose the preferred unit identity and, when needed, the preferred alias spelling for that unit.

## Table

```txt
user_unit_display_overrides
- id
- workosUserId
- baseUnitId               // unit family, references units.id
- locale
- preferredUnitId          // references units.id
- preferredUnitAliasScope? // global | household | user
- preferredUnitAliasId?    // id in the scoped unit alias table
- createdAt
- updatedAt
```

## Alias target

`preferredUnitAliasScope` tells the app which alias table contains `preferredUnitAliasId`:

```txt
global    -> unit_aliases.id
household -> unit_household_aliases.id
user      -> unit_user_aliases.id
```

This is a display override-level polymorphic reference. The alias tables themselves do not need scope columns because their table names already define their scope.

## Constraints

- unique `(workosUserId, baseUnitId, locale)`
- `baseUnitId` references `units.id`
- `(preferredUnitId, baseUnitId)` foreign-keys to `units(id, baseUnitId)`

Application invariants:

- `preferredUnitAliasScope` and `preferredUnitAliasId` are both null or both present
- selected alias must match `preferredUnitId`, `baseUnitId`, and `locale`
- if scope is `user`, selected alias must belong to `workosUserId`
- if scope is `household`, selected alias must belong to the active household

SQLite/D1 cannot enforce a foreign key that points at one of several alias tables. Enforce the scoped alias lookup at the application boundary unless a future unified alias table is introduced.

## Preferred unit vs preferred alias

Use `preferredUnitId` to answer “tablespoons instead of milliliters.”

Use `preferredUnitAliasScope` + `preferredUnitAliasId` only when the user explicitly chooses label spelling, e.g. `tbsp` instead of `tablespoon`.

Do not populate this during user creation unless the user actually overrides the default.

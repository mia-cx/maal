# Preferences and display override tables

Preference tables store semantic likes/dislikes/avoidances.

Display override tables store user/household overrides for alias choice and display unit choice.

They do not store recipe or meal facts. Recipe and meal rows keep canonical normalized ids; the effective taxonomy/preferences store resolves how those ids display for a user, household, and locale.

## Base profile/settings tables

Locale, timezone, planning defaults, and cook-time coefficients live on parent profile tables:

- `users`
- `households`

## Preference tables

- `user_food_preferences`

## Display override tables

- `user_food_display_overrides`
- `household_food_display_overrides`
- `user_unit_display_overrides`
- `household_unit_display_overrides`

## Precedence for display overrides

```txt
user display override > household display override > global taxonomy default
```

Do not populate override rows during user/household creation unless a real override exists.

## Alias references

Alias display overrides need an alias scope because they may point at global, household, or user alias tables:

```txt
preferredFoodAliasScope + preferredFoodAliasId
preferredUnitAliasScope + preferredUnitAliasId
```

The scope belongs on the display override row, not on recipe/meal rows and not on the alias tables themselves.

SQLite/D1 cannot enforce a single foreign key across multiple target tables. Enforce `(scope, id)` lookup in application code unless a future unified alias table is introduced.

## Alias vs unit identity

Use food alias scope/id when choosing food labels:

```txt
preferredFoodAliasScope
preferredFoodAliasId
```

Use unit ids when choosing units, and unit alias scope/id only when overriding exact unit label spelling:

```txt
preferredUnitId
preferredUnitAliasScope?
preferredUnitAliasId?
preferredMeasureUnitId
```

A unit identity override answers “cups instead of milliliters.” A unit alias override answers “`tbsp` instead of `tablespoon`.”

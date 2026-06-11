# Taxonomy merge strategy

Taxonomy tables are the database source of truth, but app loads should not return an exhaustive taxonomy graph.

For a given request, the backend should return only the effective aliases and units relevant to:

- `workosUserId`
- active `householdId` / WorkOS organization id
- active `locale`
- optionally source domains needed for import parsing

## Precedence

Merge scoped entries and aliases in this order:

```txt
user > household > global
```

User-scoped rows win over household rows. Household rows win over global rows. Global rows provide the approved fallback.

## Effective food aliases

Inputs:

- `food_user_entries` for `workosUserId`
- `food_household_entries` for `householdId`
- `foods` global approved rows referenced by active aliases/ingredients
- `food_user_aliases` for `workosUserId`
- `food_household_aliases` for `householdId`
- `food_aliases` global approved rows
- requested `locale`
- optional source domains

Output should include the aliases the client needs for parsing/display, not every known food alias in the database.

For default display aliases:

1. `user_food_display_overrides.preferredFoodAliasScope` + `preferredFoodAliasId`
2. `household_food_display_overrides.preferredFoodAliasScope` + `preferredFoodAliasId`
3. global `food_aliases.defaultForLocale`
4. any locale alias fallback
5. `foods.id` fallback

For default measure units:

1. `user_food_display_overrides.preferredMeasureUnitId`
2. `household_food_display_overrides.preferredMeasureUnitId`
3. selected user food alias `defaultMeasureUnitId`
4. selected household food alias `defaultMeasureUnitId`
5. selected global food alias `defaultMeasureUnitId`
6. `foods.defaultMeasureUnitId`

Food display overrides let a user/household distinguish display aliases and measurement defaults without changing food identity.

## Effective unit aliases

Inputs:

- `unit_user_entries` for `workosUserId`
- `unit_household_entries` for `householdId`
- `units` global approved rows referenced by active aliases/ingredients
- `unit_user_aliases` for `workosUserId`
- `unit_household_aliases` for `householdId`
- `unit_aliases` global approved rows
- requested `locale`
- optional source domains

For default display aliases:

1. `user_unit_display_overrides.preferredUnitAliasScope` + `preferredUnitAliasId`
2. `household_unit_display_overrides.preferredUnitAliasScope` + `preferredUnitAliasId`
3. global `unit_aliases.defaultForLocale` for the selected unit/base unit
4. any locale alias fallback for the unit/base unit
5. `units.id` fallback

For selected display units:

1. `user_unit_display_overrides.preferredUnitId`
2. `household_unit_display_overrides.preferredUnitId`
3. food-specific preference/default unit from the effective food lookup
4. canonical `baseUnitId`

## Payload shape

The effective taxonomy payload should be lookup-oriented, suitable for hydrating a local client store:

```txt
{
  foodsById,
  foodUserEntriesById,
  foodHouseholdEntriesById,
  foodAliasesById,
  foodAliasesByFoodId,
  foodDisplayOverridesByFoodAndLocale,
  defaultFoodAliasByFoodAndLocale,
  defaultMeasureUnitByFoodAndLocale,

  unitsById,
  unitUserEntriesById,
  unitHouseholdEntriesById,
  unitAliasesById,
  unitAliasesByUnitId,
  unitDisplayOverridesByBaseUnit,
  defaultUnitAliasByBaseUnitAndLocale,

  locale,
  householdId,
  workosUserId,
  version
}
```

The exact shape can evolve, but the important rule is: send effective lookups, not the entire global taxonomy.

## Query behavior

Recipe and meal queries should remain lightweight.

Ingredient sidecar rows should carry normalized base fields:

- `baseFoodId`
- `baseQuantity`
- `baseUnitId`
- `baseUnitFamilyId`
- source labels/text

They should not carry alias IDs, user/household preferences, display overrides, or join every alias table for every recipe card or meal query. The UI resolves display labels, display units, locale behavior, and user/household overrides from the hydrated taxonomy store.

## Mutation behavior

When a user or household creates an alias:

1. insert the scoped alias row immediately with `adoptionStatus = pending_review`
2. optionally create a taxonomy proposal for global moderation
3. invalidate/refetch the effective taxonomy payload
4. do not mutate global alias tables until moderation approves

When a user or household creates a new food/unit identity:

1. insert the scoped entry row immediately with `adoptionStatus = pending_review`
2. insert the first scoped alias for its typed label
3. leave recipe/meal sidecars canonical: `baseFoodId`/`baseUnitId` stay null until there is a global canonical row, unless the user maps to an existing global food/unit
4. invalidate/refetch the effective taxonomy payload
5. do not mutate global `foods`, `units`, or global alias tables until moderation approves

Moderation should filter scoped entry/alias queues by `adoptionStatus = pending_review` so accepted/rejected rows do not keep resurfacing. Accepted/rejected scoped rows can remain active for their scope; the adoption status only tracks whether the row should still be considered for global taxonomy.

## Source-domain aliases

`sourceDomain` aliases are for parsing imports from specific sites. They should be included only when needed for import flows or known source domains. They should not become default display aliases.

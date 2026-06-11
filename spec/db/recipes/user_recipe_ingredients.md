# `user_recipe_ingredients`

`user_recipe_ingredients` stores one flattened ingredient line for a reusable recipe template.

It preserves source text and stores Maal's best-effort normalized food/unit math. Alias lookup, locale display, and user/household overrides are resolved from the effective taxonomy store, not stored per recipe line.

## Table

```txt
user_recipe_ingredients
- id
- userRecipeId
- lineIndex
- originalText
- sourceAmountText?
- sourceQuantity?
- sourceUnitLabel?
- sourceFoodLabel
- baseFoodId?
- baseQuantity?
- baseUnitId?
- baseUnitFamilyId?
- optional
- confidence
- createdAt
```

## Source vs normalized fields

- `originalText` is the exact imported line.
- `sourceAmountText`, `sourceQuantity`, `sourceUnitLabel`, and `sourceFoodLabel` preserve what Maal parsed from the source text.
- `baseFoodId`, `baseQuantity`, and `baseUnitId` are Maal's normalized interpretation for planning/grocery math.
- `baseUnitFamilyId` is denormalized from `units.baseUnitId` for `baseUnitId` so display/grocery code can group units without joining `units`.

## Aliases and display

Ingredient rows do not store alias IDs.

Aliases are user/household/global settings. The backend loads effective aliases once for the current user, household, and locale; the client uses that local taxonomy store to render display labels and units.

Display math happens from:

```txt
baseQuantity + baseUnitId + effective taxonomy/preferences
```

## Constraints

- unique `(userRecipeId, lineIndex)`
- `userRecipeId` references `user_recipes.id` and cascades on delete
- `baseFoodId` references `foods.id` when present
- `baseUnitId` references `units.id` when present
- when `baseUnitId` is present, `(baseUnitId, baseUnitFamilyId)` should foreign-key to `units(id, baseUnitId)`

## Reasoning

This table is the bridge between source text and normalized app behavior. Parser quality improves over time as aliases are added, but recipe rows only need stable source text plus normalized base food/unit fields.

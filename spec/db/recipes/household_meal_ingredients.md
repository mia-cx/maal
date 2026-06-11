# `household_meal_ingredients`

`household_meal_ingredients` stores meal-local ingredient lines.

Rows are copied from `user_recipe_ingredients` when a recipe is added to a meal, then edited independently for substitutions, omissions, serving changes, and grocery planning.

## Table

```txt
household_meal_ingredients
- id
- householdMealId
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
- includeInGroceryList
- confidence
- createdAt
```

## Source vs normalized fields

- `originalText` is the exact meal-local line text.
- `sourceAmountText`, `sourceQuantity`, `sourceUnitLabel`, and `sourceFoodLabel` preserve what Maal parsed from that line.
- `baseFoodId`, `baseQuantity`, and `baseUnitId` are Maal's normalized interpretation for grocery math.
- `baseUnitFamilyId` is denormalized from `units.baseUnitId` for `baseUnitId` so display/grocery code can group units without joining `units`.

## Aliases and display

Meal ingredient rows do not store alias IDs.

Aliases are user/household/global settings. Display labels, display units, locale behavior, and manual alias overrides are resolved from the effective taxonomy store on the client.

If a planned meal diverges, update the meal-local source/normalized fields directly:

- substitution: change `sourceFoodLabel` and `baseFoodId`
- amount/unit edit: change source amount fields and `baseQuantity`/`baseUnitId`/`baseUnitFamilyId`
- omission: set `includeInGroceryList = false` or remove/archive the row depending on UX

## Constraints

- unique `(householdMealId, lineIndex)`
- `householdMealId` references `household_meals.id` and cascades on delete
- `baseFoodId` references `foods.id` when present
- `baseUnitId` references `units.id` when present
- when `baseUnitId` is present, `(baseUnitId, baseUnitFamilyId)` should foreign-key to `units(id, baseUnitId)`

## Reasoning

Grocery generation should read from meal-local normalized fields, not source recipe rows or display aliases. Planned meals may intentionally differ from templates.

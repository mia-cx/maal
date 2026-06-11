# `user_recipe_nutrition_facts`

`user_recipe_nutrition_facts` stores flattened schema.org NutritionInformation properties for a reusable recipe template.

## Table

```txt
user_recipe_nutrition_facts
- id
- userRecipeId
- nutrient
- schemaOrgProperty
- originalText
- amount?
- unitId?
- baseAmount?
- baseUnitId?
- locale?
- confidence
- createdAt
- updatedAt
```

## Nutrients

Examples:

- `calories`
- `carbohydrate`
- `cholesterol`
- `fat`
- `fiber`
- `protein`
- `saturated_fat`
- `serving_size`
- `sodium`
- `sugar`
- `trans_fat`
- `unsaturated_fat`
- `other`

## Constraints

- `userRecipeId` references `user_recipes.id` and cascades on delete
- `unitId` / `baseUnitId` reference `units.id` when present
- when `unitId` is present, `(unitId, baseUnitId)` should foreign-key to `units(id, baseUnitId)` so the denormalized base unit cannot drift
- unique `(userRecipeId, schemaOrgProperty)` where practical

## Reasoning

Nutrition import is often localized text. Preserve `originalText`, then store parsed amount/unit when possible with confidence.

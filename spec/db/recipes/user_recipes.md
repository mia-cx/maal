# `user_recipes`

`user_recipes` stores user-owned reusable recipe templates.

A user recipe row stores source/import facts from schema.org/Recipe and user-owned recipe metadata. It does not store parsed ingredient taxonomy or grocery behavior directly; those live in `user_recipe_*` sidecar tables.

## Table

```txt
user_recipes
- id
- workosUserId
- savedFromHouseholdId?
- title
- description?
- imageUrl?
- prepTimeMinutes?
- cookTimeMinutes?
- totalTimeMinutes?
- yield?
- sourceYieldText?
- sourceDatePublished?
- sourceDateModified?
- sourceLanguage?
- sourceUrl?
- sourceSiteName?
- sourceAuthorName?
- sourcePublisherName?
- sourceIsBasedOnUrl?
- sourceImportedAt
- sourceHtmlHash?
- sourceRatingValue?
- sourceRatingCount?
- sourceReviewCount?
- sourceClaimedMinutes?
- parseConfidence?
- ingredientConfidence?
- instructionConfidence?
- nutritionConfidence?
- userNotes?
- deletedAt?
- createdAt
- updatedAt
```

## Source fields

Source fields preserve facts from the imported source. Author maps to `sourceAuthorName`; publisher maps to `sourcePublisherName`. We do not store full schema.org Person/Organization graphs.

## Yield fields

`yield` is Maal's parsed numeric recipe yield. Household meals copy it into `household_meals.yield` and store the planned/current yield separately as `plannedYield`.

## Visibility/deletion

`deletedAt` hides/removes a recipe from My Menu without breaking historical household meal links.

Do not hard-delete `user_recipes` rows that are referenced by `household_meal_user_recipes`.

## Derived fields

Cook history, familiarity, latest verdict, and actual-time averages are derived from household meal behavior tables, not stored here.

## Reasoning

Keep recipe templates portable and source-faithful:

- schema.org/Recipe is an import/export adapter
- source facts stay on the user recipe row
- ingredients/instructions/media/nutrition/classifications live in relational sidecars
- planning copies user recipe scalar fields and sidecars into `household_meals` and `household_meal_*` tables

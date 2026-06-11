# `household_meals`

`household_meals` stores the household-local meal instance.

A household meal is both the schedule/planning row and the meal-local recipe copy. It mirrors `user_recipes` scalar recipe fields, plus meal metadata such as schedule date/time/status and current planned yield. It always links to at least one `user_recipes` row through `household_meal_user_recipes`, but it can diverge without mutating linked recipes.

## Table

```txt
household_meals
- id
- householdId
- title
- description?
- imageUrl?
- date?                  // null means floating/unscheduled meal
- time?
- status                 // planned | cooked
- prepTimeMinutes?
- cookTimeMinutes?
- totalTimeMinutes?
- yield?                 // copied recipe/default numeric yield
- plannedYield?          // current planned yield, whole integer
- plannedCookWorkosUserId? // defaults to the user who planned the meal
- sortOrder?             // stable ordering within a date/time bucket or floating pool
- sourceYieldText?
- sourceDatePublished?
- sourceDateModified?
- sourceLanguage?
- sourceUrl?
- sourceSiteName?
- sourceAuthorName?
- sourcePublisherName?
- sourceIsBasedOnUrl?
- sourceImportedAt?
- sourceHtmlHash?
- sourceRatingValue?
- sourceRatingCount?
- sourceReviewCount?
- sourceClaimedMinutes?
- parseConfidence?
- ingredientConfidence?
- instructionConfidence?
- nutritionConfidence?
- notes?
- createdAt
- updatedAt
```

## Relationship to `user_recipes`

`household_meals` links to user recipes through `household_meal_user_recipes`. Even ad-hoc typed meals first create a `user_recipes` row, then create the household meal and join row.

Meal-local edits keep existing recipe links intact. One-off substitutions, yield changes, instruction edits, and media changes update only the copied `household_meals` fields and `household_meal_*` sidecars.

Deleting a visible recipe should archive/hide the `user_recipes` row when meals reference it, not break meal links. Meal-local copied fields and sidecars remain the operational source for planned/cooked meals.

## Mirrored recipe fields

Recipe scalar fields intentionally mirror `user_recipes` so meal-local copies survive source recipe edits/archive and can diverge independently.

## Promotion flow

If a user decides a meal-local variation should become its own reusable recipe:

1. create a new `user_recipes` row from the current `household_meals` scalar recipe fields
2. copy `household_meal_*` sidecars into matching `user_recipe_*` sidecars
3. insert a `household_meal_user_recipes` link to the new recipe
4. leave existing user recipe links unchanged

No `promotedToUserRecipeId`, link-kind, or primary-link column is needed. Promotion is represented by the user's new recipe being linked to the meal for that user's stats/history.

## Meal metadata

Schedule and planning metadata belongs directly on `household_meals`:

- `date`
- `time`
- `status`
- `yield`
- `plannedYield`
- `plannedCookWorkosUserId`
- `sortOrder`
- household ownership

Skipped/replaced meals should delete the `household_meals` row rather than preserving an archived status.

`plannedCookWorkosUserId` defaults to the user who planned the meal and can be changed when assigning a cook.

`sortOrder` is only for stable visual ordering when multiple meals share the same date/time bucket or are floating/unscheduled. It is not semantic meal state.

There is no separate `meal_recipes` wrapper table.

## Sidecars

Meal-local repeatable data lives in sidecars keyed directly to `household_meals.id`:

- `household_meal_ingredients`
- `household_meal_instructions`
- `household_meal_instruction_events`
- `household_meal_classifications`
- `household_meal_media`
- `household_meal_nutrition_facts`
- `household_meal_appliance_requirements`

## Reasoning

A planned meal needs exactly one parent row for both scheduling and local recipe state. Collapsing meal recipe data into `household_meals` avoids a redundant one-to-one table while preserving the desired behavior:

- floating cards are unscheduled household meals
- moving a meal sets/clears `date`
- meal-local edits do not mutate `user_recipes`
- archiving/hiding a linked recipe keeps historical/planned meal links and copies intact
- grocery generation reads meal-local sidecars

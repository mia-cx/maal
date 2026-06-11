# `household_meal_user_recipes`

`household_meal_user_recipes` links household meal instances to one or more user recipe templates.

A household meal has one meal-local recipe copy, but multiple users may have matching `user_recipes` rows. This join lets My Menu stats count the same household meal for each linked user's recipe without duplicating the meal.

## Table

```txt
household_meal_user_recipes
- id
- householdMealId
- userRecipeId
- createdAt
```

## Constraints

- `householdMealId` references `household_meals.id` and cascades on delete
- `userRecipeId` references `user_recipes.id`
- unique `(householdMealId, userRecipeId)`

Application invariants:

- every `household_meals` row must have at least one linked `user_recipes` row
- users only promote their own meal-local variation to their own new `user_recipes` row
- deleting a visible recipe with meal links should hide/archive the `user_recipes` row rather than deleting the link target

## Query behavior

My Menu stats should aggregate through this join:

```txt
user_recipes.id -> household_meal_user_recipes.userRecipeId -> household_meals.id
```

This supports accurate per-user stats across shared households and across meals linked to matching recipes owned by different users.

## Reasoning

Keep `household_meals` as the single meal-local recipe copy, but let many user recipe templates claim/observe that meal for stats and history.

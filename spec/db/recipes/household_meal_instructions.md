# `household_meal_instructions`

`household_meal_instructions` stores meal-local instruction steps.

## Table

```txt
household_meal_instructions
- id
- householdMealId
- stepIndex
- sectionName?
- text
- durationMinutes?
- confidence?
- createdAt
- updatedAt
```

## Constraints

- unique `(householdMealId, stepIndex)`
- `householdMealId` references `household_meals.id` and cascades on delete

## Reasoning

Meal-specific preparation can diverge from the reusable recipe template without mutating the source recipe.

# `household_meal_classifications`

`household_meal_classifications` stores meal-local copies of recipe classifications.

## Table

```txt
household_meal_classifications
- id
- householdMealId
- kind              // category | cuisine | keyword | diet
- value
- locale?
- schemaOrgValue?
- confidence
- createdAt
```

## Constraints

- `householdMealId` references `household_meals.id` and cascades on delete
- unique `(householdMealId, kind, value, locale)` where practical

## Reasoning

Meal-local copies preserve filtering/history even when the source recipe changes or is deleted.

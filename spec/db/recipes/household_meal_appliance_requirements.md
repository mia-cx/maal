# `household_meal_appliance_requirements`

`household_meal_appliance_requirements` stores meal-local appliance requirements.

## Table

```txt
household_meal_appliance_requirements
- id
- householdMealId
- appliance
- required
- source       // schema_org | instruction_heuristic | user
- confidence
- notes?
- createdAt
- updatedAt
```

## Constraints

- `householdMealId` references `household_meals.id` and cascades on delete
- unique `(householdMealId, appliance)`

## Reasoning

A planned meal can use a different appliance setup than the source recipe. Store that locally so planning warnings and household appliance checks use the meal copy.

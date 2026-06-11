# `household_meal_nutrition_facts`

`household_meal_nutrition_facts` stores meal-local nutrition facts.

## Table

```txt
household_meal_nutrition_facts
- id
- householdMealId
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

## Constraints

- `householdMealId` references `household_meals.id` and cascades on delete
- `unitId` / `baseUnitId` reference `units.id` when present
- when `unitId` is present, `(unitId, baseUnitId)` should foreign-key to `units(id, baseUnitId)` so the denormalized base unit cannot drift
- unique `(householdMealId, schemaOrgProperty)` where practical

## Reasoning

Meal-local nutrition can differ from the source recipe after substitutions or serving edits. Preserve source text and parsed confidence.

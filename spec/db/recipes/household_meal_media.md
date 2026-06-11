# `household_meal_media`

`household_meal_media` stores meal-local image and video references.

## Table

```txt
household_meal_media
- id
- householdMealId
- kind          // image | video
- position
- url?
- contentUrl?
- embedUrl?
- thumbnailUrl?
- name?
- caption?
- createdAt
```

## Constraints

- `householdMealId` references `household_meals.id` and cascades on delete
- index `(householdMealId, kind, position)`

## Reasoning

Meal-local media preserves the visible planned/cooked meal even if the reusable recipe template later changes.

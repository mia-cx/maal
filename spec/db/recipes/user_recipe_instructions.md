# `user_recipe_instructions`

`user_recipe_instructions` stores flattened instruction steps for a reusable recipe template.

## Table

```txt
user_recipe_instructions
- id
- userRecipeId
- stepIndex
- sectionName?
- text
- durationMinutes?
- confidence?
- createdAt
- updatedAt
```

## Constraints

- unique `(userRecipeId, stepIndex)`
- `userRecipeId` references `user_recipes.id` and cascades on delete

## Reasoning

Schema.org instructions may be nested HowToSection/HowToStep graphs. Maal stores a flat ordered list because the app UI and meal planning flows need ordered steps, not a lossless schema.org graph.

# `user_recipe_appliance_requirements`

`user_recipe_appliance_requirements` stores appliance requirements inferred from or attached to a reusable recipe template.

## Table

```txt
user_recipe_appliance_requirements
- id
- userRecipeId
- appliance
- required
- source       // schema_org | instruction_heuristic | user
- confidence
- notes?
- createdAt
- updatedAt
```

## Constraints

- `userRecipeId` references `user_recipes.id` and cascades on delete
- unique `(userRecipeId, appliance)`

## Reasoning

Appliance needs are operational planning metadata, not schema.org source truth. They can be inferred from instructions and edited later.

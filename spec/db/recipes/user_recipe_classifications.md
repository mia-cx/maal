# `user_recipe_classifications`

`user_recipe_classifications` stores recipe-level schema.org classification values.

## Table

```txt
user_recipe_classifications
- id
- userRecipeId
- kind              // category | cuisine | keyword | diet
- value
- locale?
- schemaOrgValue?
- confidence
- createdAt
```

## Source mapping

- `recipeCategory` -> `kind = category`
- `recipeCuisine` -> `kind = cuisine`
- `keywords` -> `kind = keyword`
- `suitableForDiet` -> `kind = diet`

## Constraints

- `userRecipeId` references `user_recipes.id` and cascades on delete
- unique `(userRecipeId, kind, value, locale)` where practical

## Reasoning

Classifications are faceted recipe metadata for filtering, search, and schema.org reconstruction. They are not food taxonomy.

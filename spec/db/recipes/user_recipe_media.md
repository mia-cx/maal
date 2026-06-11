# `user_recipe_media`

`user_recipe_media` stores image and video references for a reusable recipe template.

## Table

```txt
user_recipe_media
- id
- userRecipeId
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

- `userRecipeId` references `user_recipes.id` and cascades on delete
- index `(userRecipeId, kind, position)`

## Reasoning

Media can have multiple values and different schema.org shapes. Store useful flattened references, not the full external graph.

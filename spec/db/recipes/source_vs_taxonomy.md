# Source fields vs taxonomy fields

Recipe/meal persistence has two layers.

`user_recipes` stores reusable templates. `household_meals` stores meal-local copies plus schedule/planning metadata.

## Source fields

Source fields are copied from schema.org/Recipe, user entry, or a source `user_recipes` row:

- title
- description
- image
- times
- yield
- source URLs
- author/publisher names
- date published/modified
- rating summary
- raw ingredient/instruction text

These fields preserve what the source said. When a recipe is planned, scalar source fields are copied onto `household_meals` so meal-local behavior does not depend on the source recipe staying unchanged.

## Taxonomy fields

Taxonomy fields are Maal's best-effort interpretation:

- canonical `baseFoodId`
- canonical `baseUnitId`
- denormalized `baseUnitFamilyId`
- normalized quantity
- confidence

These fields can improve as aliases and parsers improve. Alias matching is used during parsing, but alias IDs are not stored on recipe/meal ingredient sidecars.

## Rule

Never overwrite source truth just because taxonomy mapping changes. Re-parse into sidecar interpretation fields when needed, but keep source text intact.

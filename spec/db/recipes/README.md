# Recipe and meal persistence tables

Maal has one reusable recipe parent table and one meal instance parent table:

```txt
user_recipes      // reusable user-owned recipe templates
household_meals   // meal-local copy/instance used for planning, cooking, and grocery behavior
```

There is no separate `meal_recipes` table. A planned meal is the meal-local recipe copy.

## User recipe template tables

- `user_recipes`
- `user_recipe_ingredients`
- `user_recipe_instructions`
- `user_recipe_instruction_events`
- `user_recipe_classifications`
- `user_recipe_media`
- `user_recipe_nutrition_facts`
- `user_recipe_appliance_requirements`

`user_recipes` stores source/schema.org scalar fields and user-owned recipe metadata. Sidecars store repeatable or interpreted fields.

## Household meal-local tables

- `household_meals`
- `household_meal_user_recipes`
- `household_meal_ingredients`
- `household_meal_instructions`
- `household_meal_instruction_events`
- `household_meal_classifications`
- `household_meal_media`
- `household_meal_nutrition_facts`
- `household_meal_appliance_requirements`

When a recipe is planned, Maal copies `user_recipes` scalar fields and sidecars onto `household_meals` and `household_meal_*` sidecars. Household meal rows are the source of truth for planning, cooking, and grocery generation.

## Parent-row relationship

```txt
user_recipes.id  --one or more links-->  household_meal_user_recipes.userRecipeId
household_meals.id  --one or more links-->  household_meal_user_recipes.householdMealId
```

Every household meal must have at least one linked `user_recipes` row. Ad-hoc typed meals first create a `user_recipes` row, then create the household meal and join row. If a recipe with historical/planned meals is removed from My Menu, hide/archive the `user_recipes` row rather than breaking meal links. Meal-local copied fields and sidecars remain intact.

One-off substitutions and variations update only the `household_meals` copy and `household_meal_*` sidecars while keeping existing recipe links. If the user promotes the variation, Maal creates a new `user_recipes` row from the meal-local copy, copies household sidecars into `user_recipe_*`, and adds a `household_meal_user_recipes` link to the new recipe.

My Menu stats should join through `household_meal_user_recipes` so the same household meal can count for equivalent recipes owned by different household members.

Post-meal feedback and optional cook-time facts live in `meal_check_ins`. There is no separate meal review table.

## Ingredient sidecars

Ingredient sidecars preserve source text and carry best-effort mappings to food/unit taxonomy:

- `baseFoodId` identifies canonical food identity
- `baseUnitId` identifies canonical unit identity
- `baseUnitFamilyId` denormalizes `units.baseUnitId` for lookup/grouping
- `baseQuantity` identifies normalized quantity
- source labels preserve what the source text said

Ingredient sidecars do not store alias refs. Display labels/units and locale overrides are resolved from the effective taxonomy store. Parsing should improve over time as user/household/global alias tables grow.

## Instruction sidecars

Instruction sidecars preserve instruction text and carry best-effort parsed operational events:

- appliance requirements
- temperatures
- durations
- action hints

Instruction events normalize source units through `unitId`, `baseValue`, and `baseUnitId`, while keeping the original instruction text intact.

# Domain Model

## Entity overview

- WorkOS Organization — external source of truth for households.
- WorkOS Organization Membership — external source of truth for household membership.
- `UserRecipe` — user-owned imported recipe flattened into relational rows with user-specific metadata.
- `HouseholdMeal` — a copied, editable meal instance in the household calendar, optionally anchored to a date/time. Survival is recipe metadata, not a separate entity.
- `GroceryList` — derived demand for a calendar, with persisted purchase state.
- `PantryStaple` — user-marked ingredient to suppress from grocery reminders.
- `MealCheckIn` — post-meal cook-time facts, verdict, servings, and notes.
- `HouseholdProfile` — household-level planning defaults such as default servings, available appliances, and pantry staples.
- `UserCookingProfile` — per-user cook-time coefficient keyed by WorkOS User ID.
- `HardFoodRule` / `TastePreference` — user-level constraints and preferences keyed by WorkOS User ID.

## Backend model vs API DTOs

The backend should use normalized tables with foreign keys/check constraints. The JSON/TypeScript schemas are API and MCP payloads that may include derived fields such as `timesCooked`, `latestVerdict`, or `ingredientPurchaseState`.

Do not store every derived value directly on the same record. For example, grocery purchase state belongs to grocery items because one purchased ingredient can serve multiple household meals.

## Recipe truth vs user truth

Keep these separate:

- WorkOS tenancy truth: which users can see and operate on shared household data.
- Source recipe truth: what the user/Poke imported from a linked source.
- Personal library truth: which imported recipes, preferences, and hard food rules a user can carry across households.
- Household recipe availability truth: which member-owned/saved recipes are visible to the household through membership.
- Recipe attribution truth: which user imported/created or added a recipe.
- Calendar truth: which household meals exist and whether they are in the top pool, date-only, or timed.
- Household meal truth: which copied meal instance is planned, when it is assigned, how many servings the household intends, and any one-off ingredient/instruction substitutions.
- Grocery truth: what ingredients are needed and whether they were bought.
- Cook session truth: what actually happened.
- Feedback truth: whether this meal worked for the user overall.

## Meal status rules

`planned`
: The meal exists as a household plan. If it has neither `date` nor `scheduled_for`, the UI shows it in the top pool. If it has a `date` and no time, it appears at the end of that date. If it has a time, it sorts by time.

`cooked`
: User cooked it. A `MealCheckIn` should exist if actual time or verdict was recorded.

`skipped`
: Did not happen and no replacement was recorded.

`postponed`
: Deferred after being assigned; clearing date/time returns it to the top pool without changing it into a separate status.

`replaced`
: Superseded by another household meal, takeout, or external meal.

## Plan changes and inventory stakes

Replacing or postponing a meal is lower stakes if no ingredients were purchased. Once ingredients are purchased, Poke should consider perishability and overlap before recommending changes.

Grocery items track:

- needed
- purchased
- assumed pantry
- skipped
- needs review

Purchased ingredients remain tied to source household meals until reassigned, consumed, or marked unused.

## Serving rules

Household profile has a default serving count. Each household meal can override servings for guests or missing household members. A household meal may also mark a planned cook so Maal/Poke can use that user's cook-time coefficient when estimating adjusted cook time.

Ad-hoc guest flow should score candidate meals by:

- overlap with already purchased ingredients
- extra ingredients needed
- perishable ingredients at risk
- adjusted cook time
- effort fit for capacity mode

## Ingredient merging rules

Maal should merge conservatively.

Safe merges:

- same normalized item and compatible units, e.g. `1 tbsp olive oil + 2 tbsp olive oil`.
- counted produce with same normalized item, e.g. `2 tomatoes + 3 tomatoes`.

Fuzzy merges:

- same item but incompatible units, e.g. `2 tomatoes + 1 cup diced tomatoes`.
- related but distinct forms, e.g. `cherry tomatoes` and `diced tomatoes`.

Fuzzy merges should preserve original lines and lower confidence. The display may suggest bulk buying, but should not invent precision.

## Feedback promotion rules

- Exploration/wildcard + `worth_repeating` => promote to `safe`.
- Exploration/wildcard + `neutral` => keep the exact neutral rating for future search/filtering; do not prioritize.
- Any meal + `never_again` => keep the exact never-again rating and avoid the recipe and similar suggestions.
- Safe + negative light check-in may demote from `safe`.

## Cook-time coefficient

Cook-time coefficient belongs to a WorkOS user, not the household. Start with a coefficient per WorkOS user:

```text
adjustedTotalTime = sourceTotalTime * userCookingProfile.cookTimeCoefficient
```

When a household meal has `plannedCookWorkosUserId`, use that user's coefficient for adjusted time. If actual cook differs, `MealCheckIn.actualCookWorkosUserId` records who cooked and whose coefficient should learn from the session. A meal check-in must link to a household meal, a user recipe, or both; never neither. Update slowly from actual/source ratios reported in meal check-ins. Later versions can add per-recipe, per-cuisine, or per-complexity coefficients.

## Trial meals

Household meals do not store full recipe JSON snapshots. A trial/wildcard meal is still just a `household_meals` row plus flattened household meal sidecars. This supports Poke-found meals without committing them to anyone's menu and avoids duplicating opaque recipe blobs per meal.

If the meal works, `worth_repeating` or “Add to my menu” promotes the flattened household meal rows into a `user_recipes` row. If it is `neutral` or `never_again`, the household history remains intact without polluting anyone's menu.

## Source fidelity vs operational rows

Maal treats schema.org as an import/export adapter, not the stored source of truth. Importers flatten recipe data into relational rows immediately.

Recipe and meal data:

- title, description, image/source metadata, claimed prep/cook/total time, and yield live on `user_recipes` / `household_meals`.
- ingredients live in `user_recipe_ingredients` / `household_meal_ingredients`.
- instructions live in `user_recipe_instructions` / `household_meal_instructions`.
- appliance requirements and nutrition live in their own relational sidecars.

Why relational only:

- D1 storage stays bounded; no per-meal duplicated recipe blobs.
- Grocery merging, filtering, substitutions, aliases, units, and nutrition all need queryable rows.
- Ingredient parsing is imperfect, so every flattened ingredient keeps source text (`original_text`, `source_amount_text`, `source_ingredient_label`) plus confidence.
- Export/share can reconstruct schema.org from relational rows when needed.

Adding a recipe to the plan copies recipe sidecars into household meal sidecars. One-off substitutions, allergy accommodations, omitted ingredients, and instruction tweaks mutate only the household meal rows, never the reusable recipe template.

## Grocery inclusion rules

Scheduled household meals are included in grocery generation when they fall inside the requested date/time range.

Floating household meals are excluded by default unless:

- `include_in_grocery_list` is true, or
- the grocery query explicitly selects their `household_meal_id`, or
- the caller requests top-pool meals with neither date nor time.

Default exclusions:

- cooked meals
- skipped meals
- archived meals

Replaced or floated meals may still matter if their ingredients were already purchased. Grocery responses should surface those purchased/perishable warnings rather than silently dropping them.

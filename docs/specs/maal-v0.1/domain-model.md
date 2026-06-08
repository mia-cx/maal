# Domain Model

## Entity overview

- WorkOS Organization — external source of truth for households.
- WorkOS Organization Membership — external source of truth for household membership.
- `UserRecipe` — user-owned imported `schema.org/Recipe` snapshot with user-specific metadata.
- `HouseholdMeal` — a user recipe or trial recipe snapshot in the household calendar, optionally anchored to a date/time. Survival is recipe metadata, not a separate entity.
- `GroceryList` — derived demand for a calendar, with persisted purchase state.
- `PantryStaple` — user-marked ingredient to suppress from grocery reminders.
- `MealCheckIn` — post-meal cook-time facts, verdict, servings, and notes.
- `HouseholdProfile` — household-level planning defaults such as default servings and pantry staples.
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
- Calendar truth: which household meals exist, which are floating, and which are anchored to a date/time.
- Household meal truth: which user recipe or trial recipe snapshot is planned, when it is assigned, and how many servings the household intends.
- Grocery truth: what ingredients are needed and whether they were bought.
- Cook session truth: what actually happened.
- Feedback truth: whether this meal worked for the user overall.

## Meal status rules

`floating`
: In the household meal watchlist, not assigned to a date/slot. Floating meals may roll forward indefinitely.

`scheduled`
: Assigned to a date and optional meal slot.

`cooked`
: User cooked it. A `MealCheckIn` should exist if actual time or verdict was recorded.

`skipped`
: Did not happen and no replacement was recorded.

`postponed`
: Removed from its date/time and returned to floating.

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

- New/exploration/wildcard + `worth_repeating` => promote to `safe`.
- New/exploration/wildcard + `neutral` => known neutral; do not prioritize.
- Any meal + `never_again` => avoid recipe and similar suggestions.
- Safe + negative light check-in may demote from `safe`.

## Cook-time coefficient

Cook-time coefficient belongs to a WorkOS user, not the household. Start with a coefficient per WorkOS user:

```text
adjustedTotalTime = sourceTotalTime * userCookingProfile.cookTimeCoefficient
```

When a household meal has `plannedCookWorkosUserId`, use that user's coefficient for adjusted time. If actual cook differs, `MealCheckIn.actualCookWorkosUserId` records who cooked and whose coefficient should learn from the session. A meal check-in must link to a household meal, a user recipe, or both; never neither. Update slowly from actual/source ratios reported in meal check-ins. Later versions can add per-recipe, per-cuisine, or per-complexity coefficients.

## Trial meals

Household meals may contain a duplicated recipe snapshot instead of referencing a user recipe. This supports wildcards and exploration meals that Poke found but no user has committed to their menu yet.

If the meal works, `worth_repeating` or “Add to my menu” promotes the household meal snapshot into a `user_recipes` row. If it is neutral or never again, the household history remains intact without polluting anyone's menu.

## Recipe snapshots vs operational rows

Maal stores imported recipe source truth as JSON blobs and also flattens the pieces it needs for operations.

Source truth:

- `schema_org_recipe_json`
- raw JSON-LD, when available
- source URL/site/import metadata

Operational data:

- ingredients
- instructions
- nutrition summary
- claimed prep/cook/total time
- yield/servings

Why both:

- The blob preserves fidelity and makes export/debugging possible.
- Flattened rows make grocery merging, confidence scoring, and nutrition/time summaries practical.
- Ingredient parsing is imperfect, so every flattened ingredient keeps the original source text and a confidence score.

User recipes should have flattened ingredients/instructions/nutrition. Trial household meals may also have their own flattened ingredients/instructions/nutrition when they do not reference a `user_recipes` row.

## Grocery inclusion rules

Scheduled household meals are included in grocery generation when they fall inside the requested date/time range.

Floating household meals are excluded by default unless:

- `include_in_grocery_list` is true, or
- the grocery query explicitly selects their `household_meal_id`, or
- the caller requests all floating meals.

Default exclusions:

- cooked meals
- skipped meals
- archived meals

Replaced or floated meals may still matter if their ingredients were already purchased. Grocery responses should surface those purchased/perishable warnings rather than silently dropping them.

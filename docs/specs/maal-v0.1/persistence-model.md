# Persistence Model

The TypeScript schemas in `schemas.ts` are API/MCP DTOs, not a literal database schema. The backend should store normalized, abstract records with foreign keys and derive rollups for API responses.

## Persistence principles

- Store facts once; derive summaries.
- Keep source recipe data separate from user planning data.
- Keep grocery purchase state separate from household meals.
- Use foreign keys for relationships and check constraints for enums.
- Cache derived values only when they are expensive or useful for ranking.

## Core tables

### WorkOS identity and tenancy

Maal does not store basic user, organization, or membership records. WorkOS is the source of truth for:

- users
- organizations
- organization memberships
- basic user/org profile fields
- roles/permissions, if enabled

In Maal, a household is a WorkOS Organization. Maal stores only WorkOS IDs as foreign references, such as `workos_user_id` and `workos_organization_id` / `household_id`.

### `household_profiles`

One Maal planning profile per WorkOS Organization/household. This stores household-level planning defaults, not user taste or allergy data.

Important fields:

- `household_id` / WorkOS Organization ID
- `default_servings`
- `week_starts_on`
- `preferred_mass_unit`
- `preferred_volume_unit`
- `ingredient_unit_overrides_json`
- timestamps

Canonical stored ingredient measures are metric base units: `g` for mass and `ml` for volume. Household unit fields only control display defaults and ingredient-specific display overrides, for example `olive oil: tbsp` while `water` remains `ml`.

Related tables:

- `household_appliances`, one row per known household appliance availability fact
- `pantry_staples`

### `user_cooking_profiles`

Per-WorkOS-user cooking calibration. There is no local users table; this table is keyed by WorkOS User ID.

Important fields:

- `workos_user_id`
- `cook_time_coefficient`
- timestamps

### `hard_food_rules` and `taste_preferences`

User-level food constraints and preferences. Allergies, diet constraints, and taste ratings travel with the WorkOS user across households. Household fit is derived from active household members and, later, meal attendance.

Important fields:

- `id`
- `workos_user_id`
- rule/preference subject
- rule/preference type
- notes
- timestamps

### `user_recipes`

A user's recipe collection. This maps a WorkOS User ID to flattened imported recipes and makes recipes portable across households. Maal does not have a global `recipes` table because it is not a cookbook, search index, or recipe discovery product.

Maal does not need a local `users` table unless/until it stores app-specific profile data such as avatars or display preferences.

Important fields:

- `id`
- `workos_user_id`
- `saved_from_household_id` nullable
- `title`
- `description`
- `image_url`
- `prep_time_minutes`
- `cook_time_minutes`
- `total_time_minutes`
- `servings`
- `source_url`
- `source_site_name`
- `source_html_hash`
- recipe metadata/notes
- timestamps

### Household recipe collection view

There is no separate `household_recipes` ownership table in v0.1. A household's available recipe collection is a derived view from:

- current WorkOS Organization Memberships
- those members' `user_recipes` rows
- household member preferences and feedback
- user recipes already referenced by that household's historical/current household meals

Semantically, a household recipe list is not a separate source of truth in v0.1. It is the overlap/projection of member-owned recipes, preferences, and meal history. "Add this to my menu" means creating a `user_recipes` row for the current WorkOS user. Household availability follows from membership.

This keeps recipes portable for users while still making household recipe lists easy to query. If later we need explicit household curation independent of membership, we can add a `household_recipe_collections` table.

Mutable recipe fields on `user_recipes`:

- `user_notes`
- source confidence scores
- `source_claimed_minutes`

Cook history and familiarity fields such as `timesCooked`, `lastCookedAt`, `latestVerdict`, `averageActualMinutes`, and `familiarity` are derived from `household_meals`, `meal_check_ins`, and `meal_reviews`; they are not stored on `user_recipes`.

Related operational tables:

- `user_recipe_ingredients`, one row per flattened source ingredient line.
- `user_recipe_instructions`, one row per flattened source instruction step.
- `user_recipe_classifications`, one row per `recipeCategory`, `recipeCuisine`, `keywords`, or `suitableForDiet` value.
- `user_recipe_media`, one row per image/video.
- `user_recipe_nutrition_facts`, one row per `NutritionInformation` property, preserving raw localized text plus parsed amount/unit when possible.
- `user_recipe_appliance_requirements`, one row per inferred or user-confirmed appliance. Absence means unknown; known unavailable household appliances should warn/downrank/filter depending on user intent.

These can be computed from `household_meals` and `meal_check_ins`. Cache them if ranking needs them quickly.

Ownership behavior:

- `user_recipes` are imported, flattened recipe templates owned by a WorkOS user.
- Maal never exposes a global recipe index for discovery.
- Users bring recipes into Maal themselves, either manually or through Poke, by linking/importing sources that expose `schema.org/Recipe`.
- If a member leaves a household, their personal recipes stop appearing in the household collection unless those recipes are already referenced by `household_meals`.
- Adding a recipe to another household means the user creates or already has a `user_recipes` row; household visibility follows membership.

### `household_meals`

Planned household meal row. It can reference the user recipe it came from, but it owns a flattened local copy of ingredients, instructions, nutrition, and appliance requirements. Date/time assignment is optional; meals with neither `date` nor `scheduled_for` appear in the top meal pool. Floating meal cards are unscheduled `household_meals`, not reusable recipe templates. Moving a card to a day sets `date`; moving it back clears `date`; the meal object and DB row stay the same.

Every household meal keeps local relational rows copied from the recipe at the time it entered the plan. That copy supports per-meal substitutions, omitted ingredients, portion changes, visitor allergy accommodations, and instruction tweaks without mutating the source recipe in My Menu.

Important fields:

- `id`
- `household_id`
- `user_recipe_id` nullable
- `title`
- `description`
- `image_url`
- `prep_time_minutes`
- `cook_time_minutes`
- `base_servings`
- `include_in_grocery_list` boolean
- `scheduled_for` nullable
- `date` nullable, for date-only planning
- `slot` nullable
- `sort_order` nullable, for manual ordering in the top pool and untimed day lists
- `last_considered_at` nullable
- `planned_cook_workos_user_id` nullable
- `status`
- `servings_planned`
- `servings_cooked` nullable
- replacement metadata
- timestamps

Constraints:

- Top-pool meals have neither `date` nor `scheduled_for`; date-only meals have `date` and null `scheduled_for`.
- `user_recipe_id` is provenance only; household meal sidecars are the operational source of truth for planned/cooked/grocery behavior.

Related flattened operation tables:

- `household_meal_ingredients`
- `household_meal_instructions`
- `household_meal_appliance_requirements`
- `household_meal_classifications`
- `household_meal_media`
- `household_meal_nutrition_facts`

Grocery generation uses `household_meal_ingredients`, not `user_recipe_ingredients`, because planned meals may contain one-off substitutions or omissions.

Promotion behavior:

- Trial/wildcard meals can live only as household meal rows plus sidecars.
- If the user marks a trial meal `worth_repeating` or chooses “Add to my menu”, Maal creates a `user_recipes` row from the household meal row and sidecars.
- The household meal may then store the resulting `user_recipe_id` as provenance, but keeps its own local rows for history.

### `meal_reviews`

First-party user reviews are meal-scoped rows that also carry the linked recipe id when the meal came from a saved recipe.

- `household_meal_id` is required.
- `user_recipe_id` is nullable provenance for recipe-level aggregation.
- `workos_user_id` identifies the reviewer.
- Unique constraint: one review per `(household_meal_id, workos_user_id)`.
- Multiple household members can review the same meal.
- Recipe ratings are derived by aggregating `meal_reviews` rows by `user_recipe_id`.
- Deleting a recipe nulls `user_recipe_id` on reviews but preserves the meal review.

Imported schema.org `Review` graphs are not stored in this table; those are third-party website artifacts and should only be imported if a product feature needs external review provenance.

### `grocery_lists` and `grocery_items`

Grocery lists are generated from household meals, but purchase state is persisted because it changes planning stakes.

Important `grocery_items` fields:

- `id`
- `grocery_list_id`
- `display_name`
- `quantity_json`
- `status`
- `confidence`
- `perishable`
- `purchased_at`
- `staple_match_id`

Related table:

- `grocery_item_sources` linking grocery items to household meals and original ingredient lines.

### `meal_check_ins`

Records the post-meal check-in moment: cook-time facts, servings, verdict, and notes. A check-in may be cook-only, verdict-only, or both.

Important fields:

- `id`
- `household_meal_id` nullable
- `user_recipe_id` nullable
- `planned_cook_workos_user_id` nullable
- `actual_cook_workos_user_id` nullable
- `reported_by_workos_user_id`
- `actual_minutes` nullable
- `claimed_minutes` nullable
- `cook_time_ratio` nullable
- `servings_cooked` nullable
- `verdict` nullable
- `reasons_json` nullable
- `notes`
- `created_at`

Constraints:

- at least one of `household_meal_id` or `user_recipe_id` must be present. Both may be present.
- cook-time coefficient learning only runs when `actual_cook_workos_user_id` and `actual_minutes` are present.

Promotion behavior:

- If a check-in references a household meal snapshot and the reporter has no matching user recipe, Maal can create a `user_recipes` row from that snapshot.
- `worth_repeating`, `neutral`, and `never_again` remain exact rating values used for future search/filtering; familiarity remains a derived frecency label rather than a persisted mutation.

## Derived API fields

The API can return derived summaries that are not stored directly on core rows:

- user recipe `timesCooked`
- user recipe `lastCookedAt`
- user recipe `latestVerdict`
- user recipe `averageActualMinutes`
- user recipe `familiarity`
- household meal `ingredientPurchaseState`
- meal candidate fit vectors
- grocery merge confidence
- perishable ingredient warnings
- guest accommodation grocery delta

## Why not store everything on `HouseholdMeal`?

A household meal should not own grocery purchase state because one purchased grocery item can serve multiple household meals. Keeping purchase state in grocery records lets Maal reason about overlap, substitutions, and waste.

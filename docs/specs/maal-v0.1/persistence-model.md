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
- `default_calendar_duration_days`
- `default_calendar_anchor`
- timestamps

Related tables:

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

A user's recipe collection. This maps a WorkOS User ID to imported recipe snapshots and makes recipes portable across households. Maal does not have a global `recipes` table because it is not a cookbook, search index, or recipe discovery product.

Maal does not need a local `users` table unless/until it stores app-specific profile data such as avatars or display preferences.

Important fields:

- `id`
- `workos_user_id`
- `saved_from_household_id` nullable
- `schema_org_recipe_json`
- `source_url`
- `source_site_name`
- `raw_json_ld`
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

Derived/cached fields on `user_recipes`:

- `familiarity`
- `known_status`
- `times_cooked`
- `last_cooked_at`
- `latest_verdict`
- `average_actual_minutes`
- `source_claimed_minutes`

These can be computed from `household_meals` and `meal_check_ins`. Cache them if ranking needs them quickly.

Ownership behavior:

- `user_recipes` are imported source snapshots owned by a WorkOS user.
- Maal never exposes a global recipe index for discovery.
- Users bring recipes into Maal themselves, either manually or through Poke, by linking/importing sources that expose `schema.org/Recipe`.
- If a member leaves a household, their personal recipes stop appearing in the household collection unless those recipes are already referenced by `household_meals`.
- Adding a recipe to another household means the user creates or already has a `user_recipes` row; household visibility follows membership.

### `household_meals`

Calendar event/watchlist row for a household meal. It can reference a user recipe or embed a trial recipe snapshot. Date/time assignment is optional. Household meals intentionally duplicate enough recipe data to keep trials/wildcards schedulable before anyone adds them to their menu.

Important fields:

- `id`
- `household_id`
- `user_recipe_id` nullable
- `recipe_snapshot_json` nullable
- `recipe_source_json` nullable
- `recipe_metadata_json` nullable
- `include_in_grocery_list` boolean, default false for floating meals
- `scheduled_for` nullable
- `date` nullable, for date-only planning
- `slot` nullable
- `target_eat_time` nullable
- `target_start_time` nullable
- `floating_since` nullable
- `last_considered_at` nullable
- `planned_cook_workos_user_id` nullable
- `status`
- `servings_planned`
- `servings_cooked` nullable
- replacement metadata
- timestamps

Constraints:

- exactly one of `user_recipe_id` or `recipe_snapshot_json` should be present.
- `scheduled` meals should have `scheduled_for`, `date`, or a target time.

Related flattened operation tables for trial snapshots:

- `household_meal_ingredients`
- `household_meal_instructions`
- `household_meal_nutrition`

If a household meal references `user_recipe_id`, Maal can derive ingredients from `user_recipe_ingredients`. If it is a trial snapshot, Maal uses the household meal flattened rows.

Promotion behavior:

- Trial/wildcard meals can live only as household meal snapshots.
- If the user marks a trial meal `worth_repeating` or chooses “Add to my menu”, Maal creates a `user_recipes` row from the household meal snapshot.
- The household meal keeps its snapshot for history and may also store the resulting `user_recipe_id`.

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
- `worth_repeating` promotes to safe, `neutral` stores neutral memory, and `never_again` stores avoid memory.

## Derived API fields

The API can return derived summaries that are not stored directly on core rows:

- user recipe `timesCooked`
- user recipe `latestVerdict`
- user recipe `knownStatus`
- household meal `ingredientPurchaseState`
- meal candidate fit vectors
- grocery merge confidence
- perishable ingredient warnings
- guest accommodation grocery delta

## Why not store everything on `HouseholdMeal`?

A household meal should not own grocery purchase state because one purchased grocery item can serve multiple household meals. Keeping purchase state in grocery records lets Maal reason about overlap, substitutions, and waste.

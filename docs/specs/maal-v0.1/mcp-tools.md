# MCP Tools

Poke is the primary external actor. Tool responses should include enough explanation for Poke to talk naturally to the user.

## Recipe and meal planning

### `import_recipe`

Accepts a user-provided/imported `schema.org/Recipe` payload plus source metadata. Creates or updates a `user_recipes` row for the calling WorkOS user. This is not a global recipe submission.

### `add_to_my_menu`

Copies a recipe visible from a household list, household meal, or another member's menu item into the calling user's menu. This creates a new `user_recipes` row with its own recipe metadata and feedback history.

### `add_household_meal`

Creates a `household_meals` row with optional date/time assignment. Input can reference a user recipe, or trial recipe snapshot.

### `get_calendar`

Returns household meals for a date range plus top-pool meals with neither date nor time, grocery summary, and warnings.

### `schedule_household_meal`

Assigns a household meal to a date/slot/time or moves an existing assigned household meal.

### `clear_household_meal_time`

Clears date/time assignment so the household meal returns to the top pool.

### `replace_meal`

Replaces a scheduled household meal with another household meal, takeout, or external meal. Should return ingredient impact.

### `mark_meal_cooked`

Records the cooked status and optionally creates a cook session.

### `record_meal_check_in`

Records the post-meal check-in: optional cook time, servings cooked, verdict, reasons, and notes.

## Grocery and staples

### `get_calendar_ingredients`

Returns merged ingredient demand for a calendar date range and optional selected top-pool meals.

Inputs:

- date range
- include top-pool meals: `marked`, `none`, `all`, or `selected`
- selected household meal IDs
- include pantry staples
- include purchased state

Outputs:

- grocery items to buy
- assumed pantry items
- low-confidence items needing review
- purchased items
- source recipe lines

### `mark_grocery_item_purchased`

Marks a grocery item as purchased.

### `mark_grocery_item_skipped`

Marks a grocery item as intentionally not bought.

### `add_pantry_staple`

Adds a user-controlled pantry staple with aliases.

### `remove_pantry_staple`

Removes a pantry staple.

### `list_pantry_staples`

Returns staples and aliases.

## Capacity and suggestions

Capacity mode is a request-time context from Poke/user conversation, not persisted calendar state.

### `suggest_meals_for_day`

Scores candidate meals for a date using multiple vectors:

- hard constraints
- familiarity fit
- past feedback
- adjusted cook time
- active effort and cleanup
- ingredient overlap
- purchased/perishable ingredients
- servings/guest fit
- capacity mode

### `suggest_guest_adjustment`

Given a date and extra servings, recommends meal changes that reuse already assigned, top-pool, or purchased ingredients.

### `suggest_survival_plan`

For survival mode, recommends safe low-effort fallback recipes and plan changes that minimize waste.

## Data controls

### `export_user_data`

Returns all user data in a portable JSON structure.

### `delete_user_data`

Deletes all user data.

### `delete_cook_history`

Deletes cook sessions and cook-time learning data while preserving household meals and user recipes.

# MCP Tools

Poke is the primary external actor. Tool responses should include enough explanation for Poke to talk naturally to the user.

## Recipe and meal planning

### `import_recipe`

Accepts a user-provided/imported `schema.org/Recipe` payload plus source metadata. Creates or updates a `user_recipes` row for the calling WorkOS user. This is not a global recipe submission.

### `add_to_my_menu`

Copies a recipe visible from a household list, household meal, or another member's menu item into the calling user's menu. This creates a new `user_recipes` row with its own recipe metadata and feedback history.

### `add_household_meal`

Creates a `household_meals` row as either floating or scheduled. Input can reference a user recipe, or trial recipe snapshot.

### `get_calendar`

Returns household meals for a date range plus floating meals, grocery summary, and warnings.

### `schedule_household_meal`

Assigns a floating household meal to a date/slot/time or moves an existing scheduled household meal.

### `float_household_meal`

Moves a scheduled household meal back to floating.

### `replace_meal`

Replaces a scheduled household meal with another household meal, takeout, or external meal. Should return ingredient impact.

### `mark_meal_cooked`

Records the cooked status and optionally creates a cook session.

### `record_meal_feedback`

Records `worth_repeating`, `neutral`, or `never_again` plus optional reasons/notes.

## Grocery and staples

### `get_calendar_ingredients`

Returns merged ingredient demand for a calendar date range and optional selected floating meals.

Inputs:

- date range
- include floating meals: `marked`, `none`, `all`, or `selected`
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

Given a date and extra servings, recommends meal changes that reuse already scheduled, floating, or purchased ingredients.

### `suggest_survival_plan`

For survival mode, recommends survival-tagged recipes and plan changes that minimize waste.

## Data controls

### `export_user_data`

Returns all user data in a portable JSON structure.

### `delete_user_data`

Deletes all user data.

### `delete_cook_history`

Deletes cook sessions and cook-time learning data while preserving household meals and user recipes.

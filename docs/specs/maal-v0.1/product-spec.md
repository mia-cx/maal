# Product Spec

## Goals

1. Let users keep a flexible meal plan over a user-chosen period without overcommitting to exact days too early.
2. Let Poke add, move, postpone, and reason about meals through MCP tools.
3. Generate merged grocery demand for a date range or selected household meals, excluding user-defined pantry staples by default.
4. Learn from actual cook times and simple meal verdicts.
5. Treat low capacity, skipped meals, takeout, and plan changes as normal signals, not failures.
6. Preserve user autonomy and data portability from day one.

## Non-goals for v0.1

- Full pantry inventory counts.
- Recipe discovery or global recipe indexing inside Maal.
- Perfect ingredient parsing.
- Exact nutrition reconstruction from raw ingredients.
- Complex meal-prep optimization.
- Payment/subscription logic.

## Core concepts

### Naming

The backend table/DTO name is `user_recipes` / `UserRecipe` because the data is a user-owned collection of flattened recipe templates. The UI can call this collection “my menu” / “your menu”, similar to how Spotify calls a collection a library without naming the table `user_library_items`.

### Calendar model

Maal should model meals as household calendar events, not as items inside a fixed schedule container. The default UI can still be a 7-day board because that matches common grocery rhythms, but the data model is just `household_meals`.

A household meal is always a plan, but date/time assignment is optional. Meals with neither date nor time appear in the top meal pool and can roll forward indefinitely until someone anchors them.

### User recipes

Maal imports mostly-standard `schema.org/Recipe` payloads, then stores flattened relational recipe rows plus Maal metadata. There is no global recipe catalog or recipe search index. Users bring recipes in manually or through Poke by linking/importing sources that expose Recipe schema. Source ingredient text is preserved per row even if the source website changes.

### Planning board

The default UI is a calendar board plus a top meal pool for meals without date/time. The household profile can define the default dashboard range, such as 3 days, 7 days, or a month. Individual users can override the view in the dashboard without changing the household default.

A meal may be:

- in the top pool with no date/time
- assigned to a date and optional slot/time
- cooked
- skipped
- postponed/deferred by clearing date/time
- replaced by another meal or takeout

Swapping two assigned meals is not a special status; it is just changing assignments.

### Keyboard-first interaction model

The app should eventually be fully usable keyboard-first. Shortcut handling should be centralized in a small registry rather than scattered across components. Single-letter shortcuts apply only when focus is not inside an editable field (`input`, `textarea`, `select`, contenteditable, or textbox-like controls), and modifier-key browser shortcuts must be respected.

Initial schedule shortcuts:

- `d` switches to Day view.
- `w` switches to Multi-day / week view.
- `m` switches to Month view.

Global/context-aware shortcuts:

- `?` opens a keyboard shortcut help overlay.
- `n` creates a new item in the current context:
  - Schedule: new meal.
  - My menu: new recipe/import.
  - Pantry staples: new staple/item.
  - Preferences: no-op unless a focused preference section supports creation.
- `Esc` closes modals, cancels active drag/reorder modes, or clears transient focus state.
- `/` focuses search/add/import when the current surface supports it.

Schedule/card navigation requirements:

- Calendar focus should be model-level, not only DOM focus, so shortcuts continue to work with infinite/virtualized schedule views.
- Arrow keys move calendar focus through days/columns/cells.
- `j`/`k` or arrow keys move focused meal selection within a list.
- `Enter` opens the focused meal preview.
- `e` edits the focused meal when editing exists.
- `Space` can enter a keyboard reorder mode for the focused card.
- In reorder mode, arrow keys move the card, `Enter` drops, and `Esc` cancels.
- `Shift+j` / `Shift+k` and `Shift+Down` / `Shift+Up` move focused cards down/up without entering a separate drag mode.
- Later, `Shift+Left` / `Shift+Right` should move focused cards across days/columns in multi-day and month views.

### Pantry staples

Users can mark ingredients as staples they usually have at home. Staples are excluded from the main grocery list by default, but visible in an “assumed pantry” section and can be added back ad hoc.

### Grocery demand

Maal derives grocery demand from household meals in a date range and optionally selected top-pool meals. Ingredients are merged by normalized ingredient identity where safe. Original ingredient lines are always preserved.

### Appliance fit

Maal tracks household appliance availability and recipe appliance requirements when known. This is a capability signal, not a required field for every recipe.

Rules:

- Unknown recipe appliance requirements should not block scheduling.
- Known appliance requirements should warn, filter, or downrank when the household does not have that appliance.
- Initial appliance requirements may come from `schema.org` `cookingMethod`, instruction-text heuristics, Poke enrichment, or user correction.
- Appliance availability is stored at household level because “we do not own an oven” is shared planning context.

### Capacity mode

Capacity mode describes what kind of meal fits today:

- `adventurous` — exploration/wildcard meals are welcome.
- `normal` — safe and exploration meals are acceptable.
- `low` — prefer safe, low-effort, leftovers, and short active time. Long elapsed oven/slow-cooker time may still fit if active effort is low.
- `survival` — safe, low-effort fallback recipes only; assigned meals may be deferred back to the top pool.

### Meal familiarity

Meal familiarity is derived mental-load metadata on a recipe/meal, based on household meal frecency, reviews, check-ins, and fallback behavior:

- `safe` — known-good for this household/user context, including low-effort fallback meals.
- `exploration` — new-ish, plausible, not proven safe.
- `wildcard` — intentionally outside normal preferences.

`new` is an umbrella concept for search/import context, not a persisted familiarity value. Recipe rows do not store familiarity; query/API layers derive it.

Display labels:

- `safe` => “Safe”
- `exploration` => “Exploration”
- `wildcard` => “Wildcard”

### Labels

Rating labels:

- `repeat` => “Worth repeating”
- `neutral` => “Indifferent”
- `avoid` => “Never again”

Capacity mode labels:

- `adventurous` => “Adventurous”
- `normal` => “Normal”
- `low` => “Low”
- `survival` => “Survival”

### Meal feedback

Feedback is holistic, not just taste. A meal can be “never again” because prep was awful, or “worth repeating” because it was effortless even if not exciting.

Verdicts:

- `worth_repeating` — mark/promote as safe.
- `neutral` — acceptable, but do not prioritize.
- `never_again` — avoid this recipe and similar suggestions unless explicitly requested.

Feedback is most useful for `exploration` and `wildcard` meals. Safe recipes can use lighter check-ins.

## Privacy and data controls

Day-one requirements:

- Export all user data as JSON.
- Delete all user data.
- Delete cook history separately if feasible.
- No dark-pattern retention. Delete means delete.
- User preference, allergy, diet, and feedback data are treated as sensitive.

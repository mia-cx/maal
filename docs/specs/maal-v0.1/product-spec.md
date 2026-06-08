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

The backend table/DTO name is `user_recipes` / `UserRecipe` because the data is a user-owned collection of recipe snapshots. The UI can call this collection “my menu” / “your menu”, similar to how Spotify calls a collection a library without naming the table `user_library_items`.

### Calendar model

Maal should model meals as household calendar events, not as items inside a fixed schedule container. The default UI can still be a 7-day board because that matches common grocery rhythms, but the data model is just `household_meals`.

A household meal can be scheduled to a specific date/time or stay floating indefinitely. Floating meals act like a meal watchlist: they can roll forward for months until someone decides “I'm eating this now.”

### User recipes

Maal stores user-imported recipes as mostly-standard `schema.org/Recipe` payloads plus Maal metadata. There is no global recipe catalog or recipe search index. Users bring recipes in manually or through Poke by linking/importing sources that expose Recipe schema. The stored snapshot is stable even if the source website changes.

### Planning board

The default UI is a calendar board plus a floating meal watchlist. The household profile can define the default dashboard range, such as 3 days, 7 days, or a month. Individual users can override the view in the dashboard without changing the household default.

A meal may be:

- floating in the household meal watchlist
- scheduled to a date/slot
- cooked
- skipped
- postponed back to floating
- replaced by another meal or takeout

Swapping two scheduled meals is not a special status; it is just changing assignments.

### Pantry staples

Users can mark ingredients as staples they usually have at home. Staples are excluded from the main grocery list by default, but visible in an “assumed pantry” section and can be added back ad hoc.

### Grocery demand

Maal derives grocery demand from scheduled household meals in a date range and optionally selected floating meals. Ingredients are merged by normalized ingredient identity where safe. Original ingredient lines are always preserved.

### Capacity mode

Capacity mode describes what kind of meal fits today:

- `adventurous` — exploration/wildcard meals are welcome.
- `normal` — safe and exploration meals are acceptable.
- `low` — prefer safe, low-effort, leftovers, and short active time.
- `survival` — survival-tagged recipes only; scheduled meals may be floated again.

### Meal familiarity

Meal familiarity is metadata on a recipe/meal:

- `new` — not tried yet.
- `exploration` — new-ish, plausible, not proven safe.
- `safe` — known-good for this user.
- `survival` — low-effort fallback meal.
- `wildcard` — intentionally outside normal preferences.

### Meal feedback

Feedback is holistic, not just taste. A meal can be “never again” because prep was awful, or “worth repeating” because it was effortless even if not exciting.

Verdicts:

- `worth_repeating` — mark/promote as safe.
- `neutral` — acceptable, but do not prioritize.
- `never_again` — avoid this recipe and similar suggestions unless explicitly requested.

Feedback is most useful for `new`, `exploration`, and `wildcard` meals. Safe/survival-tagged recipes can use lighter check-ins.

## Privacy and data controls

Day-one requirements:

- Export all user data as JSON.
- Delete all user data.
- Delete cook history separately if feasible.
- No dark-pattern retention. Delete means delete.
- User preference, allergy, diet, and feedback data are treated as sensitive.

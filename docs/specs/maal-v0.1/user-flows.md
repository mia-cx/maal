# User Flows

## Import a recipe from Poke

1. Poke finds a recipe site with `schema.org/Recipe` JSON-LD.
2. Poke sends the recipe to Maal with source metadata.
3. Maal stores a stable snapshot and confidence scores.
4. Poke creates a floating or scheduled `household_meals` row.

## Calendar planning

1. User/Poke adds several candidate meals to `household_meals`.
2. Some are scheduled; some stay floating.
3. Poke can ask: “On the menu: rösti, chili, and chicken rice. Want to lock one in for Wednesday?”
4. User can postpone or swap without shame.

## Grocery list

1. Poke calls `get_calendar_ingredients`.
2. Maal merges ingredient demand across meals.
3. Pantry staples are separated into “assumed pantry”.
4. Low-confidence parsed ingredients appear in “needs review”.
5. User marks purchased items after shopping.

## Ad-hoc guest

1. User says someone is joining dinner.
2. Poke calls `suggest_guest_adjustment` with extra servings.
3. Maal compares scheduled/floating meals by ingredient overlap and grocery delta.
4. Poke suggests the least wasteful switch or serving adjustment.
5. Maal returns an ad-hoc grocery delta.

## Low capacity day

1. User says they have low capacity or Poke infers it from conversation.
2. Poke passes capacity mode as request context, e.g. `low` or `survival`.
3. Maal scores calendar/floating meals for fit.
4. In survival mode, Poke may move scheduled meals back to floating and schedule a survival-tagged recipe.
5. Purchased/perishable ingredient warnings are preserved.

## After cooking

1. Poke asks how long it actually took.
2. User reports actual minutes.
3. Maal records a cook session and updates the cook-time coefficient.
4. If meal was new/exploration/wildcard, Poke asks: “Worth repeating, neutral, or never again?”
5. Maal promotes, leaves neutral, or avoids the recipe based on verdict.

## Data export/delete

1. User requests export or delete.
2. Maal performs the action without requiring Poke-specific knowledge.
3. Export includes profile, constraints, staples, user recipes, household meals, groceries, cook sessions, and feedback.

## Add to my menu

1. User sees a recipe from the household list, a household meal, or another member's menu.
2. User chooses “Add to my menu”.
3. Maal copies the recipe snapshot/source into a new `user_recipes` row for that WorkOS user.
4. Feedback, familiarity, notes, and cook history start as that user's own recipe metadata.
5. Because the user is a household member, the copied menu item is visible in the household recipe collection view.

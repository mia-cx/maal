# Meal check-in TODO

Add a lightweight post-meal check-in system for planned meals.

## Entry points

- Prompt after a scheduled meal time.
- Allow manual check-in from meal sheet and future meal context menu.
- Keep check-in separate from recipe editing.

## Flow

1. Ask: “Did you make this meal?”
2. Choices:
   - “Yes”
   - “No, skipped”
3. If skipped:
   - mark household meal `status = skipped`
   - optionally ask why later; not required for v0.1.
4. If made:
   - ask: “Did you enjoy this meal?”
   - choices:
     - “Worth repeating”
     - “Neutral”
     - “Never again”
   - optionally capture actual cook time, servings cooked, and notes.
5. Save a `meal_check_ins` row linked to the `household_meal_id` and, when present, `user_recipe_id`.

## Behavior notes

- Check-in should not mutate the source recipe directly.
- Use check-ins to update derived recipe history: times cooked, latest verdict, last cooked date, average actual minutes.
- Keep the UI low-friction; users should be able to skip optional details.
- Defer complex analytics/reasons until after the basic yes/no + verdict flow works.

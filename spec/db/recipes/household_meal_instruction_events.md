# `household_meal_instruction_events`

`household_meal_instruction_events` stores meal-local structured facts parsed from meal-local instruction text.

Meal instruction text remains source truth for the planned/cooked meal. Events are best-effort parsed sidecars for appliance, temperature, duration, and action metadata.

## Table

```txt
household_meal_instruction_events
- id
- householdMealInstructionId
- kind              // temperature | duration | appliance | action
- appliance?
- sourceText
- value?
- unitId?
- baseValue?
- baseUnitId?
- confidence
- createdAt
```

## Constraints

- `householdMealInstructionId` references `household_meal_instructions.id` and cascades on delete
- `unitId` / `baseUnitId` reference `units.id` when present
- when `unitId` is present, `(unitId, baseUnitId)` should foreign-key to `units(id, baseUnitId)` so the denormalized base unit cannot drift

## Reasoning

Meal-local events can diverge from the source recipe after appliance substitutions or instruction edits. Planning warnings and cooking guidance should read from the meal-local copy.

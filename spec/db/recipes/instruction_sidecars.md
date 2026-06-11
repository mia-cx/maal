# Instruction sidecars

Recipe and meal instruction sidecars store structured operational facts parsed from instruction text.

Instruction text remains source truth. Sidecars are best-effort interpretation for cooking/planning behavior.

## Tables

User recipe instructions:

- `user_recipe_instructions`
- `user_recipe_instruction_events`

Meal-local instructions:

- `household_meal_instructions`
- `household_meal_instruction_events`

## Minimal instruction shape

```txt
user_recipe_instructions / household_meal_instructions
- text
- stepIndex
- sectionName?
- durationMinutes?
- confidence?
```

## Parsed event shape

```txt
user_recipe_instruction_events / household_meal_instruction_events
- instructionId
- kind              // temperature | duration | appliance | action
- appliance?
- sourceText
- value?
- unitId?
- baseValue?
- baseUnitId?
- confidence
```

## Why separate events?

One instruction can contain multiple operational facts:

```txt
Preheat oven to 425°F, bake for 20 minutes, then broil for 2 minutes.
```

That can produce several sidecar rows:

```txt
temperature: 425°F -> celsius
appliance: oven
duration: 20 minutes
action: broil
duration: 2 minutes
```

Keeping events in sidecars avoids bloating instruction rows with many nullable columns.

## Source vs normalized fields

- `text` preserves the instruction source text.
- `sourceText` preserves the exact matched phrase inside that instruction.
- `unitId` preserves the parsed source unit when present.
- `baseValue` and `baseUnitId` store normalized math.
- `confidence` records parser confidence.

## Denormalization

When `unitId` is present, `baseUnitId` is denormalized from `units.baseUnitId`.

Use the composite FK pattern:

```txt
(unitId, baseUnitId) -> units(id, baseUnitId)
```

The denormalized base ref lets cooking/planning code group temperatures and durations without joining `units`, while preventing drift.

## What sidecars are for

Instruction sidecars answer:

- does this step require an appliance?
- what temperature does it use?
- what duration does it imply?
- what normalized unit/value should cooking guidance use?
- how confident was the parser?

They do not replace instruction text. If parsing is wrong, the app can re-parse events later without losing the original instruction.

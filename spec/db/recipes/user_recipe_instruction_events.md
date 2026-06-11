# `user_recipe_instruction_events`

`user_recipe_instruction_events` stores structured operational facts parsed from reusable recipe instruction text.

Instruction text remains source truth. Events are best-effort parsed sidecars for appliance, temperature, duration, and action metadata.

## Table

```txt
user_recipe_instruction_events
- id
- userRecipeInstructionId
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

## Examples

From instruction text:

```txt
Bake at 375°F for 25 minutes.
```

Events:

```txt
kind=temperature appliance=oven sourceText=375°F value=375 unitId=fahrenheit baseValue=190.56 baseUnitId=celsius
kind=duration appliance=oven sourceText=25 minutes value=25 unitId=minutes baseValue=25 baseUnitId=minutes
```

## Constraints

- `userRecipeInstructionId` references `user_recipe_instructions.id` and cascades on delete
- `unitId` / `baseUnitId` reference `units.id` when present
- when `unitId` is present, `(unitId, baseUnitId)` should foreign-key to `units(id, baseUnitId)` so the denormalized base unit cannot drift

## Reasoning

One instruction step can contain multiple structured facts. Sidecars avoid bloating `user_recipe_instructions` with nullable columns while keeping source instruction text intact.

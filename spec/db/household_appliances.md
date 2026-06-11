# `household_appliances`

`household_appliances` stores household-owned appliance inventory.

Recipe and meal appliance requirement tables describe what a recipe/meal needs. This table describes what the household actually has.

## Table

```txt
household_appliances
- id
- householdId       // WorkOS organization id
- appliance         // oven | stovetop | microwave | air_fryer | slow_cooker | rice_cooker | blender | food_processor | grill
- available
- notes?
- createdAt
- updatedAt
```

## Constraints

- unique `(householdId, appliance)`

## Reasoning

Appliances are household settings, not user settings. Planning warnings compare meal-local appliance requirements against this table.

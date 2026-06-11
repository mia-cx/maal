# `households`

`households` stores Maal-owned household settings keyed by WorkOS organization id.

WorkOS organizations are Maal households. `householdId` is the app-facing name for the WorkOS organization id; no separate `workosOrganizationId` column is needed.

## Table

```txt
households
- householdId           // WorkOS organization id
- locale
- timezone?
- weekStartsOn          // 0 Sunday ... 6 Saturday
- defaultPlannedYield
- preferredDinnerTime?
- createdAt
- updatedAt
```

## Columns

### `householdId`

Primary key. This is the WorkOS organization id.

### `locale`

Household fallback locale for shared meal planning and household-owned taxonomy display.

### `timezone`

Household planning timezone.

### `weekStartsOn`

Controls calendar/week/month layout for meal planning.

### `defaultPlannedYield`

Default planned yield for newly planned household meals.

### `preferredDinnerTime`

Household-owned dinner planning default. This does not belong on the user profile.

## Reasoning

Household planning defaults belong with the household/org because they affect shared schedules, meal plans, and grocery behavior.

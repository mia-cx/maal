# `users`

`users` stores Maal-owned user profile fields keyed by WorkOS user id.

WorkOS remains the source of truth for identity/authentication. This table stores app-specific user defaults and learned cooking behavior.

## Table

```txt
users
- workosUserId          // WorkOS user id
- locale
- timezone?
- cachedCookTimeCoefficient   // cached projection from meal_check_ins
- cookTimeCoefficientUpdatedAt?
- createdAt
- updatedAt
```

## Columns

### `locale`

BCP 47 locale used for user-owned surfaces and user preference fallback.

### `timezone`

Optional user timezone for personal display.

### `cachedCookTimeCoefficient`

Cached projection from `meal_check_ins`, used for cook-time estimates.

Source of truth is check-in history, not this column. Recompute this value when relevant check-ins are created, edited, deleted, or when the coefficient formula changes.

Example:

```txt
adjustedMinutes = sourceClaimedMinutes * cachedCookTimeCoefficient
```

## What does not belong here

- active/default household selection
- preferred dinner time
- household planning defaults

Active household comes from persistent client state, selected org/session state, or membership fallback. Preferred dinner time is household-owned.

## Reasoning

`cachedCookTimeCoefficient` is stored for query performance, but `meal_check_ins` remains the source of truth. It can be recomputed at any time.

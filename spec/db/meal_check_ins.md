# `meal_check_ins`

`meal_check_ins` stores one user's check-in for one household meal.

Meal reviews are folded into check-ins. There is no dedicated `meal_reviews` table.

## Table

```txt
meal_check_ins
- id
- workosUserId       // checking-in user
- householdMealId
- cookTime?          // minutes; only provided if this user cooked the meal
- verdict            // repeat | neutral | avoid
- reason?            // user's notes explaining the verdict
- createdAt
- updatedAt
```

## Verdicts

```txt
repeat  // Worth repeating
neutral // Indifferent
avoid   // Never again
```

## Constraints

- `workosUserId` references `users.workosUserId`
- `householdMealId` references `household_meals.id` and cascades on delete
- unique `(householdMealId, workosUserId)`
- `cookTime` must be positive when present

## Cook-time learning

`cookTime` is only present when the checking-in user cooked the meal. It feeds the cached projection on `users.cachedCookTimeCoefficient`.

`meal_check_ins` is the source of truth; `users.cachedCookTimeCoefficient` can be recomputed.

## Reasoning

A check-in captures both post-meal feedback and optional cook-time data. One row per user per meal keeps stats and reviews simple without a separate review table.

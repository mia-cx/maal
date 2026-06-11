# `user_food_preferences`

`user_food_preferences` stores user-owned food likes, dislikes, and hard avoidances.

This is semantic preference data, not display/taxonomy override data. Alias and unit display choices live in `*_display_overrides` tables.

## Table

```txt
user_food_preferences
- id
- workosUserId
- foodId       // references foods.id
- preference   // favourite | like | dislike | disallowed
- reason?
- createdAt
- updatedAt
```

## Preference values

### `favourite`

User actively enjoys this food.

### `like`

User generally likes this food.

### `dislike`

User dislikes this food but it is not forbidden.

### `disallowed`

Hard avoidance for allergies, dietary constraints, or other never-serve rules.

## Constraints

- unique `(workosUserId, foodId)`
- `foodId` references `foods.id`

## Reasoning

A single table is enough for user food preference semantics because the subject and meaning are the same: “how should Maal treat this food for this user?”

Use `disallowed` for both allergies and dietary constraints unless the product needs separate medical/legal metadata later.

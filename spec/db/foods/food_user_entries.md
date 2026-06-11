# `food_user_entries`

`food_user_entries` stores user-scoped provisional food identities.

Rows are active immediately for that WorkOS user. They let the parser/UI represent an ingredient whose canonical global `foods` row does not exist yet.

## Table

```txt
food_user_entries
- id                         // index-friendly primary key
- workosUserId               // WorkOS user id
- canonicalLabel             // user's canonical label for the food
- defaultMeasureUnitId?      // references units.id
- defaultMeasureBaseUnitId?  // denormalized from units.baseUnitId for defaultMeasureUnitId
- adoptionStatus             // pending_review | accepted | rejected
- createdAt
- updatedAt
```

## Columns

### `canonicalLabel`

The local name for the food identity, e.g. `makrut lime leaves` before that food exists globally.

### `adoptionStatus`

Tracks whether this scoped food has been reviewed for possible global adoption.

- `pending_review` — active for the user and waiting for moderation
- `accepted` — accepted into global taxonomy or intentionally mapped to an existing global food
- `rejected` — remains user-local but should not keep showing up in moderator queues

This is not an activation status. Scoped food entries are active immediately for their scope regardless of adoption status.

## Constraints

At most one user food entry per normalized label:

```ts
uniqueIndex('food_user_entries_label_unique').on(table.workosUserId, table.canonicalLabel);
```

Default measure units use a composite FK when present:

```ts
foreignKey({
	columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
	foreignColumns: [units.id, units.baseUnitId],
	name: 'food_user_entries_default_measure_unit_base_fk'
});
```

Default unit columns should be both null or both present.

## Reasoning

User entries unblock parser correction before global taxonomy is complete. They are local identity rows, not aliases. Do not add scope columns here; the table already provides user scope.

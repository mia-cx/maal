# `unit_user_aliases`

`unit_user_aliases` stores user-scoped unit aliases for canonical units.

Rows are active immediately for that WorkOS user. They are not global taxonomy truth. If a user alias should become global, create a moderation/proposal row separately and merge into `unit_aliases` after approval.

## Table

```txt
unit_user_aliases
- id                  // index-friendly primary key
- workosUserId        // WorkOS user id
- unitId              // references units.id
- baseUnitId          // denormalized from units.baseUnitId for display lookup/constraints
- alias               // singular/default alias text
- pluralAlias?        // optional display plural for count-sensitive aliases
- locale              // BCP 47 locale, e.g. en-US, en-GB, nl-NL
- sourceDomain?       // optional source-site-specific alias context
- adoptionStatus      // pending_review | accepted | rejected
```

## Columns

### `adoptionStatus`

Tracks whether this scoped alias has been reviewed for possible global adoption.

- `pending_review` — active for the user and waiting for moderation
- `accepted` — accepted into global taxonomy or intentionally equivalent to an existing global alias
- `rejected` — remains user-local but should not keep showing up in moderator queues

This is not an activation status. Scoped aliases are active immediately for their scope regardless of adoption status.

## Constraints

`baseUnitId` must match the referenced unit's base unit via composite FK:

```ts
foreignKey({
	columns: [table.unitId, table.baseUnitId],
	foreignColumns: [units.id, units.baseUnitId],
	name: 'unit_user_aliases_unit_base_fk'
});
```

Domain-scoped aliases are for parsing imports, not general display defaults. Display defaults live in unit/food preference tables.

## Reasoning

The table scope is already the alias scope: user. User aliases name canonical units; user/household preferences decide which aliases and units display by default.

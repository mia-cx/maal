# `foods`

`foods` is the global canonical ingredient identity table.

It stores approved concrete foods that can appear on a recipe ingredient line or grocery item. It does not store abstract categories, grocery departments, cuisines, variants, moderation state, or display labels.

User/household provisional food identities live in `food_user_entries` and `food_household_entries` until they are promoted or mapped to global rows.

## Table

```txt
foods
- id                        // canonical text id, e.g. garlic, arugula, spring_onion
- defaultMeasureUnitId      // references units.id
- defaultMeasureBaseUnitId  // denormalized from units.baseUnitId for lookup/constraints
```

## Columns

### `id`

The canonical ingredient id.

Examples:

- `garlic`
- `arugula`
- `spring_onion`
- `olive_oil`

The id is the stable identity. There is no separate `canonicalKey`; that would duplicate the same concept.

### `defaultMeasureUnitId`

The default unit used when the app needs a preferred measuring unit for this food and no alias/user/household override applies.

Examples:

- `garlic.defaultMeasureUnitId = cloves`
- `olive_oil.defaultMeasureUnitId = milliliters`
- `flour.defaultMeasureUnitId = grams`

This references the unit taxonomy so unit identity, aliases, localization, and conversions have one source of truth.

### `defaultMeasureBaseUnitId`

Denormalized from `units.baseUnitId` for `defaultMeasureUnitId`.

Examples:

```txt
garlic.defaultMeasureUnitId = cloves
garlic.defaultMeasureBaseUnitId = cloves

olive_oil.defaultMeasureUnitId = milliliters
olive_oil.defaultMeasureBaseUnitId = milliliters

flour.defaultMeasureUnitId = grams
flour.defaultMeasureBaseUnitId = grams
```

`defaultMeasureBaseUnitId` is not separate source of truth. It exists so hot display/default-unit lookups do not need an extra unit join.

Write-time invariant:

```txt
foods.defaultMeasureBaseUnitId == units[foods.defaultMeasureUnitId].baseUnitId
```

## Relational constraints

`defaultMeasureUnitId` and `defaultMeasureBaseUnitId` should be enforced with the same composite-FK pattern used by unit aliases.

Required `units` support index:

```ts
uniqueIndex('units_id_base_unit_unique').on(units.id, units.baseUnitId);
```

`foods` constraint:

```ts
foreignKey({
	columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
	foreignColumns: [units.id, units.baseUnitId],
	name: 'foods_default_measure_unit_base_fk'
});
```

Equivalent SQL:

```sql
FOREIGN KEY (default_measure_unit_id, default_measure_base_unit_id)
REFERENCES units(id, base_unit_id)
```

`food_aliases.foodId` references `foods.id` and cascades on delete.

Scoped alias tables also reference `foods.id`; the table itself provides user or household scope.

## Reasoning

Keep ingredient identity small and stable:

- recipe/meal sidecars can reference canonical food identity through `baseFoodId` without pulling in abstract taxonomy
- aliases/localization can evolve independently
- default units remain relational through `defaultMeasureUnitId`
- `defaultMeasureBaseUnitId` is denormalized only to make effective taxonomy lookup cheap and enforceable
- grocery rollup can be added later as a feature-specific relation if needed
- no duplicated canonical key or premature category hierarchy

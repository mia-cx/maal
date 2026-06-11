# `units`

`units` stores global canonical unit identities and conversion math.

A unit row is not a localized label. Labels, symbols, plurals, and source-site spellings live in `unit_aliases`.

User/household provisional unit identities live in `unit_user_entries` and `unit_household_entries` until they are promoted or mapped to global rows.

## Table

```txt
units
- id            // canonical unit id, e.g. grams, kilograms, milliliters, tablespoons, cups, cloves, cans, celsius, fahrenheit
- baseUnitId    // references units.id
- toBaseFactor  // numeric multiplier from this unit to baseUnitId
- toBaseOffset  // numeric offset after multiplication; usually 0
```

## Columns

### `id`

Canonical unit id.

Examples:

- `grams`
- `kilograms`
- `milliliters`
- `tablespoons`
- `cups`
- `cloves`
- `cans`
- `celsius`
- `fahrenheit`

The id is the stable unit identity. There is no separate canonical key.

### `baseUnitId`

The base unit used for conversion compatibility.

Examples:

```txt
grams.baseUnitId = grams
kilograms.baseUnitId = grams
milliliters.baseUnitId = milliliters
tablespoons.baseUnitId = milliliters
cloves.baseUnitId = cloves
cans.baseUnitId = cans
celsius.baseUnitId = celsius
fahrenheit.baseUnitId = celsius
```

Units are directly convertible when they share the same `baseUnitId`.

### `toBaseFactor`

Multiplier from this unit to its base unit.

```txt
baseValue = value * toBaseFactor + toBaseOffset
```

Examples:

```txt
grams.toBaseFactor = 1
kilograms.toBaseFactor = 1000
milliliters.toBaseFactor = 1
tablespoons.toBaseFactor = 14.78676478125
cups.toBaseFactor = 236.5882365
cloves.toBaseFactor = 1
```

### `toBaseOffset`

Offset applied after multiplication.

Most units use `0`. Temperature needs non-zero offsets.

Example with Celsius as the base temperature unit:

```txt
celsius: factor=1,   offset=0
fahrenheit: factor=5/9, offset=-17.7777777778
```

Because:

```txt
C = F * 5/9 - 17.7777777778
```

Reverse conversion:

```txt
value = (baseValue - toBaseOffset) / toBaseFactor
```

## Relational constraints

`baseUnitId` references `units.id`.

`unit_aliases` denormalizes `baseUnitId` for lookup and default-display constraints. To let SQLite/D1 verify that denormalized value, `units` must expose a composite unique key:

```ts
uniqueIndex('units_id_base_unit_unique').on(table.id, table.baseUnitId);
```

Then `unit_aliases(unitId, baseUnitId)` can foreign-key to `units(id, baseUnitId)`.

This keeps `unit_aliases.baseUnitId` query-friendly without letting it drift from `units.baseUnitId`.

Scoped alias tables also reference `units.id`; the table itself provides user or household scope.

## Ingredient-specific conversions

Do not encode food-specific conversions in `units`.

Examples that are not globally true:

- `1 clove garlic ≈ 3g`
- `1 can tomatoes ≈ 400g`
- `1 bunch cilantro ≈ ?g`

Those belong in a future food-specific conversion table if needed.

## Reasoning

Keep unit identity and unit math together:

- aliases are names only and should not affect conversion
- conversion factors are canonical facts about unit identity
- offset supports temperature conversion
- count/package units can exist without pretending they are globally convertible to mass or volume

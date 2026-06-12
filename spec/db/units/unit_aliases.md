# `unit_aliases`

`unit_aliases` stores approved localized names, symbols, and source spellings for canonical units.

Aliases are names only. Conversion math lives in `units`.

## Table

```txt
unit_aliases
- id                  // index-friendly primary key
- unitId              // references units.id, e.g. tablespoons
- baseUnitId          // denormalized from units.baseUnitId for display lookup/constraints
- alias               // singular/default alias text, e.g. tbsp, tablespoon, eetlepel
- pluralAlias?        // display plural for count-sensitive aliases, e.g. tablespoons, eetlepels
- locale              // BCP 47 locale, e.g. en-US, en-GB, nl-NL
- sourceDomain?       // optional source-site-specific alias context
- defaultForLocale    // true when this is the default display alias for baseUnitId+locale
```

## Columns

### `id`

Primary key for the alias row.

Implementation can use whatever is best for the database/runtime: integer, UUID, nanoid, etc. This is row identity, not unit identity.

### `unitId`

References `units.id`.

Example:

```txt
unitId = tablespoons
alias = tbsp
locale = en-US
```

### `baseUnitId`

Denormalized from `units.baseUnitId` for the referenced `unitId`.

Example:

```txt
unitId = tablespoons
baseUnitId = milliliters
alias = tbsp
locale = en-US
defaultForLocale = true
```

`baseUnitId` is not separate source of truth. It exists so display lookup and uniqueness constraints do not need recursive unit lookups.

Write-time invariant:

```txt
unit_aliases.baseUnitId == units[unit_aliases.unitId].baseUnitId
```

### `alias`

The singular/default alias string.

Examples:

- `g`
- `gram`
- `grams`
- `tbsp`
- `tablespoon`
- `tablespoons`
- `eetlepel`
- `el`
- `°F`
- `fahrenheit`

No separate `normalizedAlias` column in the conceptual model. Normalization is an application lookup/write concern. If lookup performance requires it later, add a generated/indexed search column deliberately.

### `pluralAlias`

Optional display plural for aliases whose plural cannot be derived mechanically or should preserve locale-specific wording.

Examples:

- `alias=eetlepel`, `pluralAlias=eetlepels`
- `alias=teentje`, `pluralAlias=teentjes`
- `alias=teen`, `pluralAlias=tenen`
- `alias=clove`, `pluralAlias=cloves`

Parsing still treats aliases as lookup rows; `pluralAlias` is for rendering selected display aliases.

### `locale`

Locale for the alias.

Examples:

- `en-US`
- `en-GB`
- `nl-NL`

Unit l10n lives here. Food l10n lives in `food_aliases`.

### `sourceDomain`

Optional domain-specific context for import parsing.

This should be rare. General aliases should leave `sourceDomain` null.

Domain-scoped aliases are for parsing imports, not general display defaults.

### `defaultForLocale`

Marks the default display alias for a base unit family in a locale.

Examples:

```txt
baseUnitId=grams       unitId=ounces       alias=oz   locale=en-US defaultForLocale=true
baseUnitId=grams       unitId=grams        alias=g    locale=nl-NL defaultForLocale=true
baseUnitId=milliliters unitId=tablespoons  alias=tbsp locale=en-US defaultForLocale=true
baseUnitId=milliliters unitId=milliliters  alias=ml   locale=en-GB defaultForLocale=true
baseUnitId=celsius     unitId=fahrenheit   alias=°F   locale=en-US defaultForLocale=true
```

There should be at most one default non-domain alias per `(baseUnitId, locale)`.

SQLite/D1 constraint:

```sql
CREATE UNIQUE INDEX unit_aliases_default_per_base_locale
ON unit_aliases(base_unit_id, locale)
WHERE default_for_locale = 1 AND source_domain IS NULL;
```

Drizzle shape:

```ts
uniqueIndex('unit_aliases_default_per_base_locale')
	.on(table.baseUnitId, table.locale)
	.where(sql`${table.defaultForLocale} = 1 AND ${table.sourceDomain} IS NULL`);
```

Additional write-time validation:

- if `sourceDomain` is not null, `defaultForLocale` must be false
- setting `defaultForLocale=true` must reject or clear any existing default for the same `(baseUnitId, locale)`

## Relational constraints

`baseUnitId` is denormalized, but SQLite/D1 can still prevent drift with a composite foreign key.

Required `units` support index:

```ts
uniqueIndex('units_id_base_unit_unique').on(units.id, units.baseUnitId);
```

Then `unit_aliases` can enforce that its `baseUnitId` matches the referenced unit:

```ts
foreignKey({
	columns: [table.unitId, table.baseUnitId],
	foreignColumns: [units.id, units.baseUnitId],
	name: 'unit_aliases_unit_base_fk'
});
```

Equivalent SQL:

```sql
FOREIGN KEY (unit_id, base_unit_id)
REFERENCES units(id, base_unit_id)
```

Domain-scoped aliases should also be prevented from becoming defaults:

```ts
check(
	'unit_aliases_domain_not_default_check',
	sql`${table.sourceDomain} IS NULL OR ${table.defaultForLocale} = 0`
);
```

## What does not belong here

### Conversion factors

Aliases do not define math.

`tbsp`, `tablespoon`, and `tablespoons` all point to the same `units.id = tablespoons`, whose conversion is stored once in `units`.

### Status

No `status` column.

Rows in `unit_aliases` are active/approved by definition. Pending or scoped unit identities and aliases live in user/household entry/alias tables and proposal/moderation tables.

## Reasoning

Keep aliases simple:

- one canonical unit can have many localized aliases
- parsing can match source text to a unit without duplicating conversion data
- display can choose the default alias for a base unit family and locale
- global alias rows are approved facts only
- `baseUnitId` is denormalized only to make hot display lookup and default uniqueness straightforward

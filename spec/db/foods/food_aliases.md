# `food_aliases`

`food_aliases` stores approved localized names and source spellings for concrete foods.

Aliases are names only. Ingredient identity lives in `foods`. A food alias may optionally choose a default measure unit for that alias/locale.

## Table

```txt
food_aliases
- id                         // index-friendly primary key
- foodId                     // references foods.id
- alias                      // actual alias text, e.g. arugula, rocket, rucola
- locale                     // BCP 47 locale, e.g. en-US, en-GB, nl-NL
- sourceDomain?              // optional source-site-specific alias context
- defaultForLocale           // true when this is the default display alias for foodId+locale
- defaultMeasureUnitId?      // optional alias-specific default measure unit
- defaultMeasureBaseUnitId?  // denormalized from units.baseUnitId for defaultMeasureUnitId
```

## Columns

### `id`

Primary key for the alias row.

Implementation can use whatever is best for the database/runtime: integer, UUID, nanoid, etc. This is row identity, not food identity.

### `foodId`

References `foods.id`.

Example:

```txt
foodId = arugula
alias = rocket
locale = en-GB
defaultForLocale = true
```

### `alias`

The actual alias string.

Examples:

- `arugula`
- `rocket`
- `rucola`
- `garlic clove`
- `cloves garlic`

No separate `normalizedAlias` column in the conceptual model. Normalization is an application lookup/write concern. If lookup performance requires it later, add a generated/indexed search column deliberately.

### `locale`

Locale for the alias.

Examples:

- `en-US`
- `en-GB`
- `nl-NL`

Food l10n lives here. Unit l10n lives in `unit_aliases`.

### `sourceDomain`

Optional domain-specific context for import parsing.

Example: if a site consistently uses a term in a nonstandard way, this can scope that alias to the source domain.

This should be rare. General aliases should leave `sourceDomain` null.

Domain-scoped aliases are for parsing imports, not general display defaults.

### `defaultForLocale`

Marks the default display alias for a food in a locale.

Examples:

```txt
foodId=arugula alias=arugula locale=en-US defaultForLocale=true
foodId=arugula alias=rocket  locale=en-GB defaultForLocale=true
foodId=arugula alias=rucola  locale=nl-NL defaultForLocale=true
foodId=garlic  alias=garlic  locale=en-US defaultForLocale=true
```

There should be at most one default non-domain alias per `(foodId, locale)`.

### `defaultMeasureUnitId`

Optional alias-specific default measure unit.

If null, inherit from `foods.defaultMeasureUnitId`.

Examples:

```txt
foodId=olive_oil alias=olive oil   locale=en-GB defaultMeasureUnitId=milliliters
foodId=olive_oil alias=cooking oil locale=en-US defaultMeasureUnitId=tablespoons
```

This lets locale/alias-specific wording choose a more natural display unit without changing the canonical food default.

### `defaultMeasureBaseUnitId`

Denormalized from `units.baseUnitId` for `defaultMeasureUnitId`.

If `defaultMeasureUnitId` is null, this must also be null.

Write-time invariant when an alias-specific unit exists:

```txt
food_aliases.defaultMeasureBaseUnitId == units[food_aliases.defaultMeasureUnitId].baseUnitId
```

## Constraints

Default alias uniqueness:

```sql
CREATE UNIQUE INDEX food_aliases_default_per_food_locale
ON food_aliases(food_id, locale)
WHERE default_for_locale = 1 AND source_domain IS NULL;
```

Drizzle shape:

```ts
uniqueIndex('food_aliases_default_per_food_locale')
	.on(table.foodId, table.locale)
	.where(sql`${table.defaultForLocale} = 1 AND ${table.sourceDomain} IS NULL`);
```

`foodId` references `foods.id`:

```ts
foodId: text('food_id')
	.notNull()
	.references(() => foods.id, { onDelete: 'cascade' });
```

Alias-specific default measure units use a composite FK when present:

```ts
foreignKey({
	columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
	foreignColumns: [units.id, units.baseUnitId],
	name: 'food_aliases_default_measure_unit_base_fk'
});
```

Domain-scoped aliases should be prevented from becoming defaults:

```ts
check(
	'food_aliases_domain_not_default_check',
	sql`${table.sourceDomain} IS NULL OR ${table.defaultForLocale} = 0`
);
```

Alias unit columns should be both null or both present:

```ts
check(
	'food_aliases_default_measure_pair_check',
	sql`(${table.defaultMeasureUnitId} IS NULL AND ${table.defaultMeasureBaseUnitId} IS NULL) OR (${table.defaultMeasureUnitId} IS NOT NULL AND ${table.defaultMeasureBaseUnitId} IS NOT NULL)`
);
```

Additional write-time validation:

- if `sourceDomain` is not null, `defaultForLocale` must be false
- setting `defaultForLocale=true` must reject or clear any existing default for the same `(foodId, locale)`

## What does not belong here

### Status

No `status` column.

Rows in `food_aliases` are active/approved by definition. Pending or scoped aliases live in user/household alias tables and proposal/moderation tables.

### User or household aliases

User/household aliases and provisional food identities are not global truth.

They should live in scoped entry/alias tables and be loaded into the local taxonomy store alongside approved global aliases.

### Conversion factors

Alias-specific units choose display/default units, not conversion math. Food-specific conversions such as `cloves -> grams for garlic` belong in a separate food-unit conversion table if needed.

## Reasoning

Keep global aliases simple:

- one canonical food can have many localized aliases
- parsing can match source text to a food without changing identity
- display can choose the default alias for a food and locale
- alias-specific default units support locale wording like olive oil vs cooking oil without changing food identity
- global alias rows are approved facts only
- no duplicated normalized domain field unless performance proves we need one

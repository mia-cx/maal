# Ingredient sidecars

Recipe and meal ingredient sidecars store source text plus normalized base food/unit fields.

They do not store alias references.

## Minimal normalized shape

```txt
originalText
sourceAmountText?
sourceQuantity?
sourceUnitLabel?
sourceFoodLabel
baseFoodId?
baseQuantity?
baseUnitId?
baseUnitFamilyId?
confidence
```

## Why no alias refs?

Aliases are user/household/global settings, not per-recipe or per-meal overrides.

Rendering should use the effective taxonomy store for the current user, household, and locale:

```txt
user aliases > household aliases > global aliases > source label > canonical id
```

That means changing a user's or household's alias preference can update display everywhere without rewriting recipe or meal ingredient rows.

## What sidecars are for

Sidecars answer:

- what did the source line say?
- what food identity did Maal understand it as?
- what normalized quantity/unit should grocery math use?
- what unit family should display/grocery code use without joining `units`?
- how confident was the parser?

Sidecars carry normalized canonical ids only. User/household alias and unit preferences live in the effective taxonomy store, not on recipe or meal rows.

They do not answer:

- what label should this user see today?
- should this locale prefer tablespoons or milliliters?
- which alias has a pending/accepted/rejected moderation state?

Those are taxonomy-store questions.

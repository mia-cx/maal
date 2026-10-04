# Prototype schema inventory

Research date: 2026-08-21

Prototype baseline: `74a12ec38f6c297d1a6adbf596234c45212bac11`

Rewrite sources: [schema catalogue](../architecture/schema-catalogue.md) and
[normalized D1 ERD](../architecture/erd.md).

## Result

The rewrite catalogue preserves the prototype's main user, household, recipe, meal, taxonomy, preference,
billing, and MCP concepts. It also makes four clear changes:

1. It adds local-first revisions, tombstones, Dexie aggregates, an outbox, and ordered server changes.
2. It replaces scope-specific taxonomy tables with scoped `foods`, `food_aliases`, `units`, and
   `unit_aliases` records.
3. It replaces a meal-to-recipe join table with one nullable provenance link.
4. It moves MCP keys from denormalized KV records into normalized D1 tables.

The catalogue is not yet a field-complete schema specification. It does not lock several prototype fields,
enum values, pair constraints, uniqueness rules, or delete behaviors. The omissions that can change product
behavior are:

- `recipes.saved_from_household_id`;
- instruction `duration_minutes` and `confidence`;
- structured instruction-event payload rules;
- classification normalization and locale fields;
- the exact media and nutrition source-fidelity fields;
- the membership mutation lock or a replacement for it;
- the prototype trial fields;
- MCP presets and the explicit all-households grant;
- all design-only grocery, pantry, rich check-in, review, and taxonomy-hierarchy shapes.

This report calls a concept **preserved** when the catalogue names it clearly, even if it does not yet name
the exact column. **Changed** means the catalogue specifies a different representation or invariant.
**Omitted** means the catalogue has no clear counterpart. The last category needs a decision. It does not
mean every item should survive the rewrite.

## Sources and authority

The final prototype D1 shape has 41 tables. The most compact authoritative source is the
[final Drizzle snapshot](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/drizzle/meta/0007_snapshot.json).
The TypeScript definitions supply enum intent and relations:

- [users, households, appliances, and the membership lock](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/households.ts)
- [recipes and recipe sidecars](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/user-recipes.ts)
- [meals and copied sidecars](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/household-meals.ts)
- [foods and food preferences](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/food.ts)
- [units](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/units.ts)
- [display overrides](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/preferences.ts)
- [check-ins](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/meal-check-ins.ts),
  [billing](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/billing.ts), and
  [invites](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/household-invites.ts)

The prototype's Effect file says it is a review-only draft and is not wired into the app. It is evidence of
product intent, not runtime authority. The same applies to the larger DTO file.
[Effect draft](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/docs/specs/maal-v0.1/taxonomy-effect-schemas.ts#L1-L5),
[DTO draft](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/docs/specs/maal-v0.1/schemas.ts#L1-L3).

## D1 identity, tenancy, billing, and access

| Prototype entity                      | Prototype fields and invariants                                                                                                                                                                                                                                                                                                              | Rewrite disposition                                                                                                                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                               | `workos_user_id` PK; `locale`; nullable `timezone`; cached cook-time coefficient and update time; nullable `trial_household_id` and `trial_started_at`; timestamps.                                                                                                                                                                          | **Preserved:** identity, locale, timezone, coefficient, coefficient time. **Omitted:** both trial fields. **Changed:** mutable rows gain `revision`; WorkOS IDs stay primary keys.                                                                                                                 |
| `households`                          | `household_id` PK; locale, timezone, `week_starts_on`, `default_planned_yield`, preferred dinner time, creator, timestamps.                                                                                                                                                                                                                  | **Preserved:** every domain field. **Changed:** WorkOS organization terminology becomes explicit and mutable rows gain `revision`.                                                                                                                                                                 |
| `household_appliances`                | UUID PK; household FK; appliance; available; notes; timestamps. Unique `(household_id, appliance)`. Household deletion cascades.                                                                                                                                                                                                             | **Preserved** at field and uniqueness level, except exact appliance values are not locked in the catalogue.                                                                                                                                                                                        |
| `household_invites`                   | UUID PK; household FK; raw unique `code`; creator; `role_slug`; `max_uses`; `uses_count`; expiry, revocation, creation time.                                                                                                                                                                                                                 | **Preserved:** role, use, expiry, revocation, and ownership facts. **Changed:** UUIDv7 and a code hash replace random UUID plus raw code. This is a security improvement.                                                                                                                          |
| `household_membership_mutation_locks` | One row per household; `owner_token`; `expires_at`; timestamps. It serializes WorkOS membership changes.                                                                                                                                                                                                                                     | **Omitted.** `household_memberships` is a new D1 mirror, but it does not replace the command lock. Decide whether membership commands still need a per-household lease.                                                                                                                            |
| `billing_subscriptions`               | Household PK/FK; Stripe customer, nullable subscriber, subscription and price IDs; status; period end; cancellation flag; timestamps. Household deletion cascades. Status is `active`, `canceled`, `incomplete`, `incomplete_expired`, `past_due`, `paused`, `trialing`, `unpaid`, or `unknown`; only `active` and `trialing` count as paid. | **Preserved** as a household-owned subscription. **Not locked:** status values, paid-status mapping, timestamps, and cascade behavior. The separate entitlement research may supersede this table with WorkOS-backed subscription authority.                                                       |
| WorkOS memberships                    | No D1 table. Runtime calls WorkOS. Membership ID, organization, user, role, directory-managed status, and creation time appear in service DTOs.                                                                                                                                                                                              | **Changed:** `household_memberships` becomes a D1 authorization and sync mirror with membership ID, organization, user, role, status, and last verification time. WorkOS remains authoritative. The rewrite drops `directory_managed` and `created_at` unless those fit under an unstated payload. |

Sources:
[users](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/users.ts),
[households and lock](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/households.ts),
[membership-lock migration](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/drizzle/0006_household_membership_mutation_locks.sql),
[membership projection](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/household/members.ts), and
[billing statuses](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/billing/status.ts).

## Recipe aggregate

### Recipe parent

The prototype `user_recipes` row contains:

- identity and ownership: `id`, `workos_user_id`, nullable `saved_from_household_id`;
- presentation: `title`, `description`, `image_url`;
- timing and yield: prep, cook, total, and source-claimed minutes, numeric yield, source yield text;
- import provenance: published and modified dates, language, URL, site, author, publisher, based-on URL,
  imported time, HTML hash, source rating value/count, and review count;
- quality: parse, ingredient, instruction, and nutrition confidence;
- user state: `user_notes` and `deleted_at`;
- creation and update times.

The rewrite renames this aggregate `recipes`. It **preserves** all groups through its source/import metadata,
timing, confidence, notes, timestamps, and tombstone wording. It **omits** `saved_from_household_id`; this is
the only prototype parent field without a plausible named home. It **changes** IDs to UUIDv7 and adds
`revision`. The prototype bounds each confidence to `[0, 1]`; the rewrite does not restate those checks.

Source:
[prototype recipe table](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/user-recipes.ts#L28-L86).

### Recipe sidecars

| Prototype entity                     | Complete prototype payload                                                                                                                                                                                                                                                                                                                                                       | Rewrite disposition                                                                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_recipe_ingredients`            | Stable ID, recipe FK, `line_index`, `original_text`, source amount text, source quantity, source unit label, required source food label, nullable normalized food, base quantity, normalized unit and family, optional flag, confidence, creation time. Unique recipe/line. Food deletion nulls normalization. Unit and family are both null or both set. Confidence is `[0,1]`. | **Preserved:** ordered source text, quantity, normalized food/unit references, optionality and confidence fit the named ingredient sidecar. **Added:** notes. **Not locked:** distinct source fields, unit-pair rule, unique position, delete behavior, confidence range. |
| `user_recipe_instructions`           | Stable ID, recipe FK, `step_index`, optional section, text, optional duration, optional confidence, timestamps. Unique recipe/step; confidence is `[0,1]`.                                                                                                                                                                                                                       | **Preserved:** ID, order, section, and text. **Omitted:** duration and confidence. Unique position and confidence rules are not locked.                                                                                                                                   |
| `user_recipe_instruction_events`     | Stable ID, instruction FK, kind, optional appliance, required source text, numeric value, unit, base value, base unit, confidence, creation time. Units form a pair. `appliance` events require only appliance; `temperature` and `duration` require numeric and unit values; `action` carries none of those payloads. Confidence is `[0,1]`.                                    | **Preserved:** event family and kinds at a high level. **Changed:** the rewrite says events are ordered, but the prototype has no event position. **Omitted:** source text, normalized values, confidence, the unit-pair rule, and the discriminated payload rule.        |
| `user_recipe_appliance_requirements` | Stable ID, recipe FK, appliance, required flag, source, confidence, notes, timestamps. Unique recipe/appliance; confidence is `[0,1]`.                                                                                                                                                                                                                                           | **Preserved** under appliance kind and requirement metadata. **Not locked:** individual fields, uniqueness, confidence range, appliance values, and source values.                                                                                                        |
| `user_recipe_classifications`        | Stable ID, recipe FK, kind, display value, normalized value, optional schema.org value, locale, confidence, creation time. Unique recipe/kind/normalized value/locale; confidence is `[0,1]`.                                                                                                                                                                                    | **Preserved:** classification identity, label, and confidence. **Omitted or mislabeled:** normalized value, schema.org value, locale, and uniqueness. The catalogue says `source`, which the prototype row does not have.                                                 |
| `user_recipe_media`                  | Stable ID, recipe FK, image/video kind, position, four optional URL forms, name, caption, creation time. At least one URL form is required.                                                                                                                                                                                                                                      | **Preserved:** ID, order, kind, URLs, and descriptive metadata. **Changed or added:** attribution metadata. **Not locked:** exact URL forms and non-empty payload rule.                                                                                                   |
| `user_recipe_nutrition_facts`        | Stable ID, recipe FK, nutrient, schema.org property, required original text, parsed amount/unit, normalized base amount/unit, locale, confidence, timestamps. Unique recipe/schema.org property. Unit and base unit form a pair; confidence is `[0,1]`.                                                                                                                          | **Preserved:** nutrient, amount, unit, basis, source concept. **Omitted:** schema.org identity, original text, locale, confidence, uniqueness, and unit-pair rule.                                                                                                        |

The prototype cascades recipe deletion to every recipe sidecar. The rewrite replaces all sidecar collections
atomically with the parent's revision and sync row. This is a deliberate stronger aggregate invariant.

Sources:
[recipe sidecars](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/user-recipes.ts#L88-L307),
[shared checks](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/checks.ts), and
[taxonomy enums](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/recipe-taxonomy.ts).

## Meal aggregate and check-ins

### Meal parent and provenance

The prototype `household_meals` row contains:

- `id`, `household_id`, title, description, and image;
- nullable date, time, sort order, planned cook, numeric source yield, and integer planned yield;
- status, prep/cook/total time, and notes;
- the same source/import and four confidence groups as a recipe;
- creation and update times.

The rewrite **preserves** these fields through copied recipe/source fields and named planning fields. It
**adds** `revision` and a tombstone. The prototype only permits `planned`, `cooked`, and `skipped`; the rewrite
does not lock an enum. Prototype confidence checks and planned-cook `ON DELETE SET NULL` are also unstated.

Provenance **changes**. The prototype uses `household_meal_user_recipes`, with stable ID, meal and recipe FKs,
creation time, and a unique pair. Its shape permits several source recipes per meal, though current commands
insert one. Recipe deletion is blocked by the default FK behavior. The rewrite stores at most one nullable
`source_recipe_id`; recipe deletion nulls it and keeps the copied meal. The rewrite representation matches
current command behavior and improves historical retention.

Source:
[prototype meal and provenance](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/household-meals.ts#L29-L118).

### Copied meal sidecars

The seven copied meal tables mirror their recipe counterparts exactly, with a meal or meal-instruction FK:

- `household_meal_ingredients`
- `household_meal_instructions`
- `household_meal_instruction_events`
- `household_meal_appliance_requirements`
- `household_meal_classifications`
- `household_meal_media`
- `household_meal_nutrition_facts`

The same preserved and omitted field findings from recipe sidecars apply. Every table cascades with its meal
or instruction. Planning copies ingredient, instruction, event, classification, media, and nutrition rows.
The prototype does not copy appliance requirements in the generic copy operation, despite having the meal
table. The rewrite explicitly says planning copies every sidecar family, including appliance requirements.
That is a behavior fix, not just a schema port.

Sources:
[meal sidecars](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/household-meals.ts#L120-L342) and
[copy operation](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/services/meal-sidecars.ts#L71-L121).

### Meal check-ins

The implemented `meal_check_ins` row has `id`, reporting `workos_user_id`, nullable `household_meal_id`,
nullable positive integer `cook_time`, required verdict, nullable reason, and timestamps. Verdict is `repeat`,
`neutral`, or `avoid`. A meal/user pair is unique. User deletion cascades; meal deletion nulls the meal FK.

The rewrite **preserves** the identity, meal, reporter, actual time, verdict, reason, timestamps, and unique
meal/user rule. It **adds** a stored cooked flag, notes, revision, and tombstone. It does not lock the positive
time check or verdict values. Its wording implies that meal ID is required, which **changes** the prototype's
nullable FK. The prototype `cooked` command input updates meal status; it is not stored on the check-in.

Sources:
[check-in schema](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/meal-check-ins.ts) and
[check-in command](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/services/check-ins.ts).

## Taxonomy and preferences

The rewrite makes a deliberate structural change. The prototype separates global canonical rows, global
aliases, user/household aliases of global rows, and user/household proposed entries. The rewrite gives every
food, alias, unit, and unit alias an explicit `global`, `user`, or `household` scope. This removes four pairs
of nearly identical tables and lets scoped entries participate as real taxonomy identities.

### Foods

| Prototype entity                              | Complete prototype payload and invariant                                                                                                                                                                                                          | Rewrite disposition                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `foods`                                       | ID; required default measure unit and base-unit family as a composite FK.                                                                                                                                                                         | **Changed:** becomes a scoped row with canonical label, default unit, and adoption status. The composite default-unit relationship is preserved conceptually but not specified exactly.             |
| `food_aliases`                                | ID, food FK, alias, locale, optional source domain, locale-default flag, optional default measure unit/family, timestamps. Only one non-domain default per food/locale. Domain aliases cannot be defaults. Measure IDs are both null or both set. | **Changed:** folds into scoped `food_aliases`. Core fields are preserved. **Not locked:** pair rule, conditional uniqueness, and domain/default exclusion.                                          |
| `food_user_aliases`, `food_household_aliases` | Scope owner plus the global-alias fields, without `default_for_locale`, and with adoption status. Household identity is unique by household/food/locale/alias.                                                                                    | **Changed:** fold into scoped `food_aliases`. **Preserved:** owner scope, locale, domain, default measure, adoption. **Omitted:** household uniqueness and any equivalent user uniqueness decision. |
| `food_user_entries`, `food_household_entries` | ID, owner, canonical label, nullable default measure unit/family, adoption status, timestamps. Label is unique per owner. Measure IDs are paired.                                                                                                 | **Changed:** become user/household-scoped `foods`. All domain fields survive conceptually. Exact owner-label uniqueness and pair rules are unstated.                                                |
| `user_food_preferences`                       | ID, user FK, global food FK, preference, optional reason, timestamps. One row per user/food. Preference is `favourite`, `like`, `dislike`, or `disallowed`.                                                                                       | **Preserved** as `food_preferences`. **Not locked:** enum, uniqueness, timestamps, and whether preferences may target scoped foods.                                                                 |

### Units

| Prototype entity                              | Complete prototype payload and invariant                                                                                                                                           | Rewrite disposition                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `units`                                       | ID, base-unit ID, conversion factor and offset. Self-FK to base unit; unique `(id, base_unit_id)`.                                                                                 | **Preserved:** family/base unit and affine conversion. **Changed:** scoped entries gain canonical label and adoption status. Exact self-FK and identity pair are unstated. |
| `unit_aliases`                                | ID, unit/base pair, alias, plural alias, locale, source domain, locale-default flag, timestamps. One non-domain default per base family/locale. Domain aliases cannot be defaults. | **Changed:** folds into scoped `unit_aliases`. Fields survive conceptually. Conditional uniqueness and domain/default exclusion are unstated.                              |
| `unit_user_aliases`, `unit_household_aliases` | Scope owner plus unit/base pair, singular/plural alias, locale, source domain, adoption status, timestamps. Household identity is unique by household/base family/locale/alias.    | **Changed:** fold into scoped `unit_aliases`. Exact unit-family FK and household uniqueness are unstated.                                                                  |
| `unit_user_entries`, `unit_household_entries` | ID, owner, canonical label, global base unit, conversion factor/offset, adoption status, timestamps. Label is unique per owner.                                                    | **Changed:** become scoped `units`. All fields survive conceptually. Exact label uniqueness and base-unit FK are unstated.                                                 |

### Display preferences

The prototype has four separate tables:

- `user_food_display_overrides` and `household_food_display_overrides`: ID, owner, food, locale, optional
  preferred alias scope/ID, optional preferred measure unit/base pair, timestamps; unique owner/food/locale;
- `user_unit_display_overrides` and `household_unit_display_overrides`: ID, owner, base unit, locale, required
  preferred unit, optional preferred alias scope/ID, timestamps; unique owner/base-family/locale.

Every optional alias is a scope/ID pair. Every optional food measure is a unit/base pair. A user alias scope can
be global, household, or user. A household alias scope can only be global or household.

The rewrite **changes** these to `food_display_preferences` and `unit_display_preferences`, each with a user
or household scope. It **preserves** the food, unit, alias, locale, and family choices. It does not lock owner
uniqueness, paired-null constraints, or allowed alias-scope combinations. The explicit precedence
`user > household > global` is preserved and promoted to a shared invariant.

Sources:
[food tables](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/food.ts),
[unit tables](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/units.ts),
[display overrides](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/db/schema/preferences.ts), and
[duplicate cleanup plus household uniqueness](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/drizzle/0007_petite_the_professor.sql).

## MCP keys

The prototype stores MCP keys in Workers KV, not D1. The hash of the raw `mk_` key is the KV key. Its JSON
value contains `id`, `userId`, a household grant of either `all` or an explicit list, permission scopes,
label, optional preset, creation time, expiry, revocation, and last use. Presets are `read_only_planner`,
`meal_planner`, and `full_access`. A separate per-user KV index lists hashed key names. Raw secrets are returned
once and never stored.

The rewrite **changes** this into D1 `mcp_keys` plus `mcp_key_households`. It **preserves** owner, hash, label,
permissions, expiry, revocation, last use, one-time raw secret behavior, and unique household grants. It
**omits** preset and an explicit representation of the prototype's `all` household grant. The normalized
design should decide whether `all` means no grant rows, a key-level flag, or eager rows for current households.

Source:
[prototype MCP key store](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/auth/mcp-keys.ts#L29-L56).

## Prototype contract shapes not represented by implemented D1

These shapes matter because the user asked for a rewrite of the earlier app, not merely a port of its final
tables. They were design drafts. None was runtime-authoritative in the prototype.

| Draft concept                             | Fields or invariant                                                                                                                                                                                            | Rewrite disposition                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rich `Ingredient` taxonomy                | Canonical key and label; ingredient/variant kind; parent ingredient; grocery rollup ingredient; measure kind; category; lifecycle status. Separate labels include normalized label, source, and review status. | **Omitted** from the rewrite's simpler `foods` model, except canonical label, default unit, aliases, and adoption status.                          |
| Rich `Unit` taxonomy                      | Canonical key, symbol, mass/volume/count kind, base key, positive factor, lifecycle status; separate normalized labels.                                                                                        | **Partly preserved.** Base unit and conversion survive. Canonical key, symbol, measure kind, lifecycle status, and normalized labels are omitted.  |
| `TaxonomyProposal`                        | Proposal type, status, creator, locale, source domain, arbitrary payload.                                                                                                                                      | **Changed or omitted.** Scoped entries and aliases carry adoption status, but no proposal aggregate or creator/payload is named.                   |
| Rich meal statuses                        | `planned`, `cooked`, `skipped`, `postponed`, `replaced`, `archived`.                                                                                                                                           | **Unresolved.** The implemented table only has the first three. The rewrite says `status` without an enum.                                         |
| Planning details                          | Grocery inclusion, scheduled timestamp, slot, servings cooked, last-considered time, replacement meal/kind, and ingredient purchase state.                                                                     | **Omitted.** Date, time, sort order, planned yield, and planned cook survive.                                                                      |
| `MealReview`                              | Meal and recipe provenance, reviewer, optional 1-5 rating and verdict, title/body, timestamps; unique meal/reviewer.                                                                                           | **Omitted.** `meal_check_ins` carries a verdict and reason but cannot represent the full review.                                                   |
| Rich `MealCheckIn`                        | Meal or recipe must exist; planned cook, actual cook, reporter, actual/claimed minutes, ratio, servings, optional verdict, reason list, notes.                                                                 | **Mostly omitted.** The rewrite's check-in is the smaller implemented model plus cooked flag, revision, and tombstone.                             |
| Household profile additions               | Default calendar view, appliance list, pantry staples.                                                                                                                                                         | **Partly preserved.** Appliances survive as D1 rows. Calendar view belongs in local `uiState` if it is not shared. Pantry staples are omitted.     |
| `HardFoodRule`, broader `TastePreference` | Allergies and diet constraints; preferences for food, recipe, cuisine, texture, or tag.                                                                                                                        | **Partly preserved.** `food_preferences` can express food-level preference and a disallowed value. Other hard rules and subject types are omitted. |
| Grocery domain                            | `GroceryList`, `GroceryItem`, source lines, quantity, purchase status, confidence, perishability, meal links, pantry and review groups.                                                                        | **Omitted.** No D1 or Dexie store is named.                                                                                                        |
| Derived planning DTOs                     | Meal fit vector, candidate score/reasons/warnings/grocery delta, derived recipe cooking and verdict summaries.                                                                                                 | **Correctly absent from persistence**, but their query contracts still need Effect schemas if the rewritten dashboard uses them.                   |
| Export DTO                                | Profile, cooking profile, rules, preferences, recipes, meals, groceries, and check-ins.                                                                                                                        | **Omitted** from the catalogue. It belongs in the contract specification, not necessarily D1.                                                      |

Sources:
[Effect draft](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/docs/specs/maal-v0.1/taxonomy-effect-schemas.ts),
[DTO draft](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/docs/specs/maal-v0.1/schemas.ts), and
[persistence-model intent](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/docs/specs/maal-v0.1/persistence-model.md).

## Cross-cutting invariant comparison

| Prototype invariant                                                                                                                                        | Rewrite disposition                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Domain IDs use `crypto.randomUUID()`; WorkOS IDs key user and household records.                                                                           | **Changed:** all domain IDs, devices, invitations, and mutations use UUIDv7. WorkOS identity keys remain.                             |
| Only recipes use a soft-delete timestamp. Meals hard-delete; sidecars cascade; check-in meal links become null.                                            | **Changed:** mutable aggregate parents use tombstones. Recipe deletion also nulls meal provenance.                                    |
| No aggregate revision exists. Client clocks and `updated_at` are the only row recency facts.                                                               | **Changed:** every mutable aggregate parent gets `revision`; D1 supplies canonical conflict order.                                    |
| Sidecar order uses unique ingredient line and instruction step indexes. Media has a position. Instruction events have no position.                         | **Preserved and extended:** ordered sidecars get stable IDs and positions. The exact uniqueness rule should be restated.              |
| Confidence values are nullable or required according to the row and constrained to `[0,1]`.                                                                | **Preserved only as fields.** Effect and D1 range constraints are not locked in the catalogue.                                        |
| Unit references use composite `(unit_id, base_unit_id)` foreign keys. Optional pairs are both null or both set.                                            | **Preserved conceptually.** Exact composite FKs and paired-null checks are not locked.                                                |
| Ingredients preserve original source text after normalization fails. Nutrition preserves original localized text. Instruction events preserve source text. | **Partly preserved:** the catalogue explicitly keeps ingredient source text. Nutrition and event source text need explicit treatment. |
| Recipe and meal sidecars are normalized in D1. Meal sidecars are copied operational state, independent after planning.                                     | **Preserved.** Dexie deliberately collapses each complete aggregate into one record.                                                  |
| The prototype has no local-first cache, outbox, server change log, sync cursor, or device identity.                                                        | **Changed:** the rewrite adds all of them. These are new schema families, not ports.                                                  |
| WorkOS is the only membership authority and every request can call it.                                                                                     | **Changed:** WorkOS stays authoritative, while D1 and Dexie carry a verified membership projection for authorization and sync.        |
| MCP keys live in eventually consistent KV with a repairable user index.                                                                                    | **Changed:** normalized D1 keys and grants remove the secondary KV index.                                                             |

## Decisions needed before migrations

1. Lock every enum and exact sidecar payload. The catalogue currently names families but not implementable
   Effect schemas.
2. Decide each omission in this report. The highest-priority items are recipe origin, instruction details,
   membership locking, rich check-ins, and grocery/pantry scope.
3. Write the D1 uniqueness, foreign-key, delete, pair, confidence, and event-payload constraints beside the
   Effect aggregate contracts.
4. Specify the Dexie aggregate records as exact versioned Effect schemas. The current store list only gives
   indexes and high-level contents.
5. Keep design-only future concepts out of v1 only through explicit scope decisions. Otherwise the rewrite
   will silently narrow the app while appearing to preserve its model.

# Schema catalogue

Effect Schema is authoritative for shared contracts. D1 remains normalized through Drizzle; Dexie stores
versioned complete aggregates. This catalogue fixes names, ownership, and invariants before table migrations
arrive in the vertical slices.

## Shared conventions

- WorkOS user and organization IDs are identity primary keys.
- Domain records, devices, invitations, and mutations use client-generated UUIDv7 identifiers.
- Mutable aggregate parents carry `revision`, `created_at`, and `updated_at`; tombstoned parents additionally
  carry nullable `deleted_at`.
- Ordered sidecars carry a stable ID and position. Replacing a sidecar collection is atomic with its parent
  revision and sync-change row.
- Dates and timestamps cross boundaries as Effect-decoded ISO strings. Client wall clocks never order sync
  conflicts.

## D1 identity and tenancy

| Table                   | Key and ownership        | Required fields and invariants                                                                           |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `users`                 | `workos_user_id`         | Locale, timezone, cached cook-time coefficient and coefficient timestamp.                                |
| `households`            | `workos_organization_id` | Locale, timezone, week start, default planned yield, dinner time, creator user ID.                       |
| `household_memberships` | WorkOS membership ID     | Organization ID, user ID, role, status, last verified time; unique organization/user pair.               |
| `household_invites`     | UUIDv7, household-owned  | Invite-code hash, creator, role, use limit/count, expiry and revocation times. Raw codes are not stored. |
| `household_appliances`  | UUIDv7, household-owned  | Appliance kind, availability, notes; unique organization/appliance pair.                                 |

WorkOS remains authoritative for users, organizations, and memberships. The D1 membership table is a mirror
used for inexpensive authorization and synchronization.

## D1 recipe aggregate

`recipes` is user-owned and carries source/import metadata, title, description, image, yield, claimed timing,
confidence fields, notes, revision, timestamps, and tombstone. Its normalized sidecars are:

| Table                           | Contents                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `recipe_ingredients`            | Ordered source text, quantity, normalized food/unit references, confidence, and notes. |
| `recipe_instructions`           | Ordered instruction text and optional section.                                         |
| `recipe_instruction_events`     | Ordered timing, temperature, appliance, and other structured events.                   |
| `recipe_appliance_requirements` | Appliance kind and requirement metadata.                                               |
| `recipe_classifications`        | Classification identity, label, source, and confidence.                                |
| `recipe_media`                  | Ordered media URL/type/attribution metadata.                                           |
| `recipe_nutrition_facts`        | Nutrient identity, amount, unit, basis, and source.                                    |

Every recipe sidecar references exactly one recipe. Sidecar collections are replaced atomically; they are not
independently synchronized aggregates.

## D1 meal aggregate and check-ins

`meals` is household-owned and carries a nullable `source_recipe_id`, copied recipe/source fields, date, time,
sort order, planned cook, yield, status, notes, revision, timestamps, and tombstone. Planning copies all
operational fields into `meal_ingredients`, `meal_instructions`, `meal_instruction_events`,
`meal_appliance_requirements`, `meal_classifications`, `meal_media`, and `meal_nutrition_facts`.

`meal_check_ins` is keyed by UUIDv7 and contains meal ID, reporting user ID, cooked flag, actual cook time,
verdict, reason/notes, revision, timestamps, and tombstone. A meal/user pair is unique. Recipe deletion nulls
meal provenance but never deletes a meal or check-in.

## D1 taxonomy and preferences

| Table                      | Scope and invariant                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `foods`                    | Global, user, or household scope; canonical label, default unit, adoption status.              |
| `food_aliases`             | Food-owned alias with scope, locale, optional source domain, and locale-default flag.          |
| `units`                    | Global, user, or household scope; family/base unit, conversion factor/offset, canonical label. |
| `unit_aliases`             | Unit-owned singular/plural aliases with scope, locale, source domain, and default flag.        |
| `food_preferences`         | User/food preference and reason.                                                               |
| `food_display_preferences` | User-or-household food alias/unit choice by locale.                                            |
| `unit_display_preferences` | User-or-household unit/alias choice by family and locale.                                      |

Resolution precedence is `user > household > global`. Source text survives failed normalization. Household
meal copies may reference only globally or household-visible taxonomy identities.

## D1 billing, MCP, and sync

| Table                     | Key and invariant                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `billing_subscriptions`   | Household ID; Stripe customer/subscription/price IDs, subscriber, status, period end, cancellation state.                            |
| `stripe_events`           | Stripe event ID; type, processing state, processed time, error summary for idempotent webhooks.                                      |
| `mcp_keys`                | UUIDv7; owner, hashed secret, label, permissions, last-use, expiry, revocation. Raw keys are shown once.                             |
| `mcp_key_households`      | Key/household pair with permissions; pair is unique.                                                                                 |
| `sync_changes`            | Autoincrement sequence; unique mutation ID, actor, audience, entity, operation group, revision, Effect-encoded payload, server time. |
| `sync_devices`            | Device UUID; user, display name, last cursor, last-seen time.                                                                        |
| `sync_bootstrap_versions` | Scope/scope ID; bootstrap generation, earliest retained sequence, update time.                                                       |

The domain mutation, normalized aggregate write, idempotency receipt, and `sync_changes` row share one D1
transactional batch.

## Dexie device registry

The `maal-v1-profiles` database contains profile WorkOS user ID, display name/avatar, per-user database name,
last-used time, optional PIN salt/verifier, and retry/backoff metadata. The PIN is an application gate, not
encryption. It contains no domain aggregates or cloud tokens.

## Dexie per-profile database

Each database is named `maal-v1:<environment>:<workosUserId>` and owns these stores:

| Store                                          | Record shape / indexes                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `meta`                                         | Database and contract versions, device ID, migration state.             |
| `households`                                   | Complete household records; organization ID.                            |
| `memberships`                                  | Membership records; compound user/status and household/status indexes.  |
| `recipes`                                      | Complete recipe aggregates; owner, deletion state, title/search tokens. |
| `meals`                                        | Complete meal aggregates; compound household/date/status/sort indexes.  |
| `mealCheckIns`                                 | Complete check-ins; unique meal/user compound index.                    |
| `foods`, `foodAliases`, `units`, `unitAliases` | Effective taxonomy records; scope and locale indexes.                   |
| `taxonomyPreferences`                          | User/household display choices by locale and family.                    |
| `capabilities`                                 | Last decoded capability set and source session metadata.                |
| `outbox`                                       | Versioned mutations; status/creation-time index and unique mutation ID. |
| `syncState`                                    | Per-audience cursor, bootstrap generation, and coordinator lease state. |
| `uiState`                                      | Non-domain view, selection, drag, scroll, and dialog persistence only.  |

The current profile ID is not duplicated merely for isolation. Owner IDs remain where ownership is a domain
fact, including recipes projected from another household member.

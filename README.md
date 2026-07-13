# Maal Greenfield Local-First Rewrite

## Summary

Rebuild Maal on an empty orphan branch as a client-side, offline-first SvelteKit PWA:

- Dexie is the only data source observed by the UI.
- Each previously authenticated WorkOS user gets an isolated local database.
- The app continues working offline indefinitely.
- D1 provides optional paid backup, multi-device sync, household collaboration, and MCP.
- D1 remains normalized through Drizzle; Dexie stores complete domain aggregates.
- Existing prototype data is not migrated.
- Existing UI is rebuilt for performance. Only the schedule scroll/snap SDK is cleanly ported.
- The current ERD is reused as domain knowledge, then redrawn around explicit ownership and sync aggregates.

## Locked product decisions

### Identity and local profiles

- A user must authenticate with WorkOS once to create a local profile.
- WorkOS user IDs and organization IDs remain application primary keys.
- Domain records, devices, and mutations use client-generated UUIDv7 IDs.
- A small device-level profile registry lists previously authenticated profiles.
- Every profile opens a separate Dexie database named by deployment and WorkOS user ID.
- Multiple profiles may coexist on one browser, Netflix-style.
- An optional per-profile PIN prevents casual access or editing.
- The PIN is only an application gate; IndexedDB is not encrypted.
- Forgotten PIN recovery requires authenticating as that WorkOS user online. Removing a profile without authentication deletes its local database.

### Local access and billing

Local functionality is never subscription-gated:

- Manual recipe creation and editing
- Meal planning
- Check-ins
- Local taxonomy/preferences
- Local export
- Offline app use

A household subscription enables:

- D1 backup and synchronization
- Multi-device use
- Multi-user household collaboration
- MCP access

Membership in any subscribed household enables cloud backup of that member’s personal recipe library. Household-owned meals and check-ins sync only for subscribed households.

URL import remains an online, separately rate-limited service rather than part of the sync entitlement.

When a subscription ends:

- Local data and local editing continue.
- Unsynced mutations remain queued.
- Remote sync, collaboration, and MCP pause.
- Re-subscribing resumes synchronization.
- The UI must never lock or obscure locally available data because billing expired.

### Ownership

- Recipes are user-owned templates.
- A household’s menu is derived from recipes owned by its current members.
- Adding a recipe to the plan creates a household-owned meal and copies the recipe fields and sidecars.
- Planned meals do not change when their source recipe is edited.
- A meal retains an optional source recipe reference for provenance.
- Deleting a recipe sets that provenance reference to `null` but preserves meal history.
- Ingredient and instruction overrides modify only the household meal copy.

### Technical authority

- Authenticated app routes are a client-side SPA with SSR disabled.
- Public/legal pages may remain static or prerendered.
- Worker endpoints continue to handle auth, sync, billing, imports, and MCP.
- The UI reads and observes Dexie only.
- HTTP responses never hydrate components or Nanostores directly.
- Nanostores/Svelte state may hold ephemeral interaction state only: selection, dialog state, current view, drag state, and scroll position.
- Domain writes go through commands that atomically update Dexie and enqueue a mutation.

## Repository and branch strategy

Create the rewrite without disturbing the prototype:

1. Record the current prototype branch and commit in the rewrite documentation.
2. Create a sibling worktree.
3. Create `rewrite/local-first-v1` as an orphan branch in that worktree.
4. Scaffold a new TypeScript/SvelteKit application with pnpm, Cloudflare adapter, Vitest, Playwright, ESLint, and Prettier.
5. Use a single application package rather than introducing a monorepo.
6. Commit the architecture plan, ERD, schema catalogue, sync protocol, and performance budgets before feature implementation.
7. Copy no existing route, store, or data-access implementation.
8. Port the scroll/snap SDK only after extracting its framework-neutral behavior and adding characterization tests.

The new deployment uses distinct resources:

- New staging and production D1 databases
- New cache names and service-worker version namespace
- `maal-v1-profiles` for the profile registry
- `maal-v1:<environment>:<workosUserId>` for user databases

No current D1 migration or prototype IndexedDB migration is provided.

## Shared domain contracts

Use `effect/Schema` as the canonical runtime contract system.

Shared schemas cover:

- `LocalProfile`
- `UserProfile`
- `Household`
- `HouseholdMembership`
- `HouseholdSettings`
- `RecipeAggregate`
- `RecipeIngredient`
- `RecipeInstruction`
- `RecipeInstructionEvent`
- `RecipeMedia`
- `RecipeNutritionFact`
- `MealAggregate`
- `MealCheckIn`
- `Food`
- `FoodAlias`
- `Unit`
- `UnitAlias`
- `TaxonomyPreferences`
- `CapabilitySet`
- `SyncMutation`
- `SyncChange`
- Sync request and response envelopes

Rules:

- Effect schemas validate all network and persistence boundaries.
- Domain code receives decoded values, never unchecked JSON.
- Drizzle rows have explicit aggregate mappers.
- Dexie records use versioned aggregate schemas.
- Svelte components do not operate on Effects directly; adapters expose live stores and Promise-like command functions.
- Schema decoding does not occur during rendering.

## D1/Drizzle schema

All mutable parent entities have:

- `revision INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `deleted_at TEXT NULL` where tombstones are required

### Identity and tenancy

#### `users`

- `workos_user_id` primary key
- locale and timezone
- cached cook-time coefficient
- coefficient update timestamp
- creation/update timestamps

#### `households`

- `workos_organization_id` primary key
- locale and timezone
- week start
- default planned yield
- preferred dinner time
- creator WorkOS user ID
- timestamps

#### `household_memberships`

Mirror of WorkOS tenancy for inexpensive authorization and synchronization:

- WorkOS membership ID primary key
- organization ID
- user ID
- role
- status
- last verified timestamp
- unique organization/user constraint

WorkOS remains authoritative. Login, WorkOS webhooks, and explicit reconciliation update this mirror.

#### `household_invites`

- Client-generated ID
- organization ID
- invite code hash
- creator user ID
- role
- use limit/count
- expiry/revocation timestamps

#### `household_appliances`

- ID
- organization ID
- appliance kind
- availability
- notes
- unique organization/appliance constraint

### User recipes

Rename the current `user_*` family to the simpler recipe aggregate vocabulary:

- `recipes`
- `recipe_ingredients`
- `recipe_instructions`
- `recipe_instruction_events`
- `recipe_appliance_requirements`
- `recipe_classifications`
- `recipe_media`
- `recipe_nutrition_facts`

`recipes` includes:

- Owner WorkOS user ID
- Source/import metadata
- Title, description, image and yield
- Claimed preparation/cooking times
- Parsing confidence fields
- User notes
- Aggregate revision and tombstone

Sidecars retain ordered source text, normalized taxonomy references, confidence values, and source fidelity. Sidecar collections are replaced atomically as part of the recipe aggregate.

### Household meals

Use:

- `meals`
- `meal_ingredients`
- `meal_instructions`
- `meal_instruction_events`
- `meal_appliance_requirements`
- `meal_classifications`
- `meal_media`
- `meal_nutrition_facts`

`meals` includes:

- Household/organization ID
- Nullable `source_recipe_id`
- Copied title, description, media and source metadata
- Date, time and sort order
- Planned cook
- Planned yield
- Status
- Notes
- Aggregate revision and tombstone

Remove the current many-to-many meal/recipe join. A planned meal has at most one source recipe; the copied aggregate is operational truth.

### Check-ins

`meal_check_ins` includes:

- ID
- Household meal ID
- Reporting WorkOS user ID
- Whether the user cooked
- Actual cook time
- Verdict: repeat, neutral, or avoid
- Reason/notes
- Revision and tombstone
- Unique meal/user constraint

Cook-time coefficients and menu statistics are derived projections, not duplicated truth.

### Taxonomy

Collapse the current global/user/household table explosion into scoped identities:

#### `foods`

- ID
- Scope type: global, user, or household
- Nullable scope ID
- Canonical label
- Default unit ID
- Adoption status
- Timestamps

#### `food_aliases`

- ID
- Food ID
- Scope type and nullable scope ID
- Alias and locale
- Optional source domain
- Default-for-locale flag
- Adoption status

#### `units`

- ID
- Scope type and nullable scope ID
- Unit family/base unit
- Conversion factor and offset
- Canonical label
- Adoption status

#### `unit_aliases`

- ID
- Unit ID
- Scope type and nullable scope ID
- Singular/plural aliases
- Locale and source domain
- Default-for-locale flag

#### Preferences

- `food_preferences`: user/food preference and reason
- `food_display_preferences`: user-or-household food alias/unit choice by locale
- `unit_display_preferences`: user-or-household display unit/alias choice by family and locale

Precedence remains:

`user > household > global`

A user-scoped taxonomy identity embedded in a shared recipe remains visible through preserved source text. Household meal copies may reference only global or household-visible taxonomy identities; otherwise they copy the source label with a nullable canonical reference.

### Billing and MCP

#### `billing_subscriptions`

- Household ID primary key
- Stripe customer/subscription/price identifiers
- Subscriber user ID
- Status and period end
- Cancellation state
- Timestamps

#### `stripe_events`

- Stripe event ID primary key
- Type
- Processing state
- Processed timestamp
- Error summary

This makes webhook handling idempotent.

#### `mcp_keys`

- Key ID
- Owner user ID
- Hashed secret
- Label
- Permissions
- Creation, last-use, expiry and revocation timestamps

#### `mcp_key_households`

- Key ID
- Household ID
- Granted permissions
- Unique key/household constraint

Raw keys are shown once and never stored.

### Sync infrastructure

#### `sync_changes`

- `seq INTEGER PRIMARY KEY AUTOINCREMENT`
- Unique mutation ID
- Actor user ID
- Audience type: user or household
- Audience ID
- Entity type and entity ID
- Operation/patch kind
- Aggregate revision
- Effect-encoded patch payload
- Server timestamp

#### `sync_devices`

- Device UUID
- User ID
- Display name
- Last cursor
- Last-seen timestamp

#### `sync_bootstrap_versions`

- Scope and scope ID
- Bootstrap generation
- Earliest retained change sequence
- Updated timestamp

D1 writes the domain mutation and corresponding change atomically using `D1Database.batch()`, whose statements execute as a transactional batch and roll back together on failure. [Cloudflare D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## Dexie schema

### Device profile registry

A small database contains only:

- Profile WorkOS user ID
- Display name/avatar
- Per-user database name
- Last-used timestamp
- Optional PIN salt and verifier
- PIN attempt/backoff metadata

PIN verification uses Web Crypto PBKDF2 with a unique salt and delayed retry. Documentation must explicitly state that this is not data encryption.

### Per-user database

Stores:

- `meta`
- `households`
- `memberships`
- `recipes`
- `meals`
- `mealCheckIns`
- `foods`
- `foodAliases`
- `units`
- `unitAliases`
- `taxonomyPreferences`
- `capabilities`
- `outbox`
- `syncState`
- `uiState`

Dexie stores complete recipe and meal aggregates, including sidecar arrays. It does not mirror normalized D1 sidecar tables.

Required indexes include:

- Recipe owner, deletion state, title/search tokens
- Meal household/date/status/sort order
- Check-in meal/user
- Taxonomy scope and locale
- Outbox status/creation time
- Sync cursor scope
- Household membership user/status

The current profile’s user ID is not repeated merely for database isolation. Owner IDs remain where they are domain facts, such as recipes owned by another household member.

## Sync protocol

### Local command transaction

Every domain command performs one Dexie transaction:

1. Decode and validate command.
2. Read current aggregate.
3. Apply the optimistic patch.
4. Increment the local revision marker.
5. Store the updated aggregate.
6. Append an outbox mutation with a UUIDv7 mutation ID.
7. Commit both writes together.

The UI updates from Dexie live queries only.

### Push

`POST /api/sync/push`

Request:

```ts
{
  protocolVersion: number;
  deviceId: string;
  mutations: SyncMutation[];
}
```

Response:

```ts
{
  accepted: Array<{
    mutationId: string;
    changeSeq: number;
    revision: number;
  }>;
  rejected: Array<{
    mutationId: string;
    code: string;
    retryable: boolean;
  }>;
  serverCursor: number;
}
```

Rules:

- Maximum 100 mutations and 512 KB per request.
- Mutation ID is the idempotency key.
- Duplicate mutation IDs return the original accepted result.
- Mutations are typed domain commands, not arbitrary object patches.
- Statements condition their work on the mutation not already existing.
- Parent, sidecars, change row, and receipt are one D1 batch.
- Authorization and subscription capabilities are checked for every mutation.

### Conflict policy

Use server-sequenced patch last-write-wins:

- D1 acceptance sequence determines order.
- Mutations change named field groups rather than replacing stale aggregates.
- Recipe metadata, recipe ingredients, recipe instructions, meal schedule, meal details and check-in fields are separate patch groups.
- Concurrent disjoint patches both survive.
- Two changes to the same group resolve to the higher server sequence.
- Deletion creates a tombstone.
- Restoration is an explicit later mutation.
- Client wall clocks never decide conflicts.

### Pull

`GET /api/sync/pull?cursor=<seq>&limit=<n>`

Response:

```ts
{
  changes: SyncChange[];
  nextCursor: number;
  hasMore: boolean;
  resetRequired: boolean;
}
```

The client applies ordered changes to Dexie in one transaction, advances the cursor only after success, and lets live queries update the UI.

After pushing, the coordinator always pulls through the returned server cursor so the originating client observes the canonical D1 result through the same D1 → Dexie path as every other device.

### Bootstrap

`GET /api/sync/bootstrap`

- Paginates complete authorized aggregates.
- Includes the owner’s recipes when personal recipe sync is entitled.
- Includes meals/check-ins for subscribed households.
- Includes member recipes visible to subscribed households.
- Includes effective taxonomy and preferences.
- Finishes with the cursor corresponding to the snapshot.

If a client cursor predates retained changes, the server returns `resetRequired`. The client preserves its outbox, rebuilds synced projections from bootstrap, reapplies pending local mutations, then resumes push/pull.

### Membership-derived recipe visibility

- Recipe ownership remains user-scoped.
- A recipe becomes visible to other members through shared current membership.
- Membership addition triggers a household recipe-projection reset/bootstrap event.
- Membership removal triggers local removal of that member’s recipes on the next online reconciliation.
- Previously downloaded shared data cannot be remotely revoked while a device remains offline; this limitation is documented.

### Cross-tab coordination

Only one tab synchronizes a profile at a time using a profile-specific Web Lock. This is the standard leader-election use case for synchronizing IndexedDB. [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

- Other tabs observe Dexie and receive coordinator status through `BroadcastChannel`.
- If Web Locks are unavailable, use an expiring lease stored in Dexie.
- Profile switching releases the coordinator and closes the prior database.
- A profile synchronizes only when the live WorkOS session belongs to that profile.
- Other cached profiles remain usable locally and show “sign in as this profile to sync.”

## Service worker and SPA lifecycle

- Disable SSR for authenticated application routes.
- Cache versioned, hashed application assets.
- Use network-first navigation with cached-shell fallback.
- Never cache auth, billing, sync, import, or MCP responses.
- Register with `updateViaCache: "none"`.
- Call `registration.update()` on application launch, online restoration, and return from extended backgrounding. [Service-worker update documentation](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)
- When a new worker is waiting:
  1. Pause new sync batches.
  2. Wait for active Dexie transactions to settle.
  3. Ask the waiting worker to activate.
  4. Reload once on `controllerchange`.
- A failed update keeps the currently working cached shell.
- New releases support the current and previous sync protocol versions.
- Dexie upgrades are additive first; destructive store migrations require a separate release after successful field telemetry.
- The service worker deletes obsolete prototype Cache Storage entries, but does not silently delete old prototype IndexedDB.

## Public server interfaces

- `/api/session` — current WorkOS identity, households, memberships and capabilities
- `/api/sync/bootstrap`
- `/api/sync/push`
- `/api/sync/pull`
- `/api/import/recipe`
- `/api/billing/status`
- `/api/billing/checkout`
- `/api/billing/portal`
- `/api/billing/webhook`
- `/api/export`
- `/mcp`
- Existing WorkOS login, callback, logout, invite and account-security endpoints

All server interfaces delegate to shared domain commands. HTTP and MCP are adapters over the same authorization and persistence behavior.

## Implementation slices

### 1. Orphan foundation

Deliver:

- Isolated orphan worktree and clean scaffold
- Architecture documentation and redrawn ERD
- Effect Schema contract conventions
- CI, lint, typecheck, unit and browser-test baseline
- Bundle, render and interaction performance budgets
- New staging D1 and local migration setup

Acceptance:

- No prototype application code is present.
- App builds and deploys as an SPA/Worker.
- Architecture and schema catalogues are committed.
- CI passes from a clean clone using a pinned pnpm version.

### 2. Offline profile shell

Deliver:

- WorkOS initial login
- Local profile registry
- Profile selector and switching
- Optional PIN
- Per-user Dexie creation
- Cached SPA shell
- Update-on-launch lifecycle
- Indefinite offline reopening

Acceptance:

- A user signs in once, goes offline, closes the browser, and reopens their profile.
- Two profiles remain fully isolated.
- Selecting a mismatched online profile never syncs under another user’s session.
- Service-worker updates do not lose local state.

### 3. Local recipe vertical

Deliver:

- Recipe aggregate schemas
- Dexie recipe repository
- Live menu query
- Manual create/edit/archive/restore/delete
- Ingredient and instruction editing
- Local search
- Export of local recipe data

Acceptance:

- Every flow works with all network requests blocked.
- Reloading during an edit cannot lose a committed recipe.
- UI components contain no remote-data hydration logic.

### 4. Paid sync spine

Deliver:

- Household/member mirror
- Subscription capability model
- Drizzle recipe and sidecar schema
- Sync change infrastructure
- Push, pull and bootstrap APIs
- Leader election and retry/backoff
- Two-device recipe convergence

Acceptance:

- Retrying a mutation produces one D1 change.
- Two devices converge after offline edits.
- Disjoint patches survive.
- Same-group conflicts resolve by server sequence.
- Unsubscribed users retain local operation but cannot call remote sync.

### 5. Complete menu and import

Deliver:

- Remaining recipe sidecars
- Source attribution and confidence
- Media, nutrition, classifications and appliances
- URL import
- Member recipe projection
- Archive/permanent-delete semantics
- Large-library search and pagination

Acceptance:

- Imported recipes enter Dexie through the same command/sync path as manual recipes.
- Another member sees an updated recipe only through D1 → Dexie pull.
- Deleting a source recipe does not delete historical meals.

### 6. Household planning and schedule SDK

Deliver:

- Meal and meal-sidecar Drizzle schema
- Recipe-to-meal copy transaction
- Dexie meal aggregates
- Offline scheduling commands
- Daily, multi-day and month views
- Clean scroll/snap SDK port
- Drag, move, postpone and delete

Acceptance:

- Planning a recipe copies all operational sidecars.
- Recipe edits do not mutate planned meals.
- Schedule interaction remains responsive with thousands of meals.
- Scroll position and snapping survive prepend/append, resize and reload.
- No schedule interaction performs network work.

### 7. Check-ins and learning

Deliver:

- Check-in schema and commands
- Offline check-in UI
- Sync behavior
- Verdict summaries
- Cook-time coefficient projection
- Derived recipe statistics

Acceptance:

- One user has at most one check-in per meal.
- Two household members can check in independently.
- Projection values can be rebuilt entirely from check-ins.

### 8. Taxonomy and preferences

Deliver:

- Scoped food/unit schema
- Alias and custom-entry commands
- Effective precedence resolver
- Dexie taxonomy projection
- Locale and temperature/unit preferences
- Ingredient rendering through effective taxonomy

Acceptance:

- User overrides household overrides global.
- Referenced source text always survives failed normalization.
- Other members do not receive unauthorized user-scoped taxonomy data.

### 9. Collaboration hardening

Deliver:

- Invitations
- Household switching
- Membership reconciliation
- Recipe visibility changes
- Subscription pause/resume behavior
- Multiple profiles and tabs
- Removal/revocation cleanup

Acceptance:

- Old-user outbox rows can never execute under a new profile.
- Removing membership purges shared projections on the next online check.
- Re-subscribing safely drains queued household mutations.
- Concurrent tabs never duplicate remote writes.

### 10. MCP and account surfaces

Deliver:

- MCP key management
- Shared recipe/planning/check-in domain commands
- Household permission grants
- Paid capability checks
- Account/security/billing/settings screens
- Local and cloud export

Acceptance:

- MCP and SPA mutations produce identical D1 changes.
- MCP cannot access unsubscribed or unauthorized households.
- Losing remote capability never prevents local export.

### 11. PWA and reliability release gate

Deliver:

- Dexie migration strategy
- Sync protocol compatibility tests
- Outbox corruption recovery
- Change-log pruning and rebootstrap
- Service-worker rollback/update tests
- Offline and flaky-network E2E
- Accessibility and performance verification
- Staging burn-in and production cutover

Acceptance:

- Fault injection covers duplicated, reordered, delayed and partially failed requests.
- Current and previous client versions can sync during rollout.
- A stale client either upgrades or receives an explicit protocol error.
- Production cutover requires no prototype data migration.
- Current prototype remains available until the new staging burn-in is accepted.

## Required test matrix

### Schema and mapping

- Effect decode/encode round trips for every aggregate and mutation
- Drizzle row-to-aggregate mapping
- Sidecar ordering and replacement
- Foreign-key and uniqueness constraints
- Tombstone preservation
- D1 migration from an empty database

### Dexie

- Per-profile isolation
- Atomic aggregate/outbox writes
- Live-query updates
- Reload persistence
- Dexie version upgrades
- Indexed range and search performance
- Optional PIN behavior and recovery

### Sync

- Duplicate mutation retry
- Push success with lost response
- Pull replay
- Out-of-order network responses
- Concurrent disjoint patches
- Same-group LWW
- Delete/restore races
- Subscription pause/resume
- Cursor expiry and bootstrap
- Membership addition/removal
- Two tabs and two devices
- Profile switch during pending sync

### Service worker

- First install
- Offline launch
- Updated worker on initial load
- Failed update fallback
- New worker while a mutation is being committed
- Hashed-asset cache cleanup
- API responses never served from cache

### Product flows

- Manual recipe offline
- Imported recipe online
- Recipe-to-meal copy
- Offline schedule edits
- Check-in offline
- Multi-member convergence
- MCP-created recipe appearing through normal pull
- Local usage after subscription expiry
- Local and cloud export

## Performance budgets

Initial defaults:

- Initial SPA entry: at most 250 KB gzip; schedule and editor routes lazy-loaded.
- No domain query or schema decode during a Svelte render loop.
- Menu remains interactive with 10,000 local recipes.
- Date-range meal lookup uses a Dexie compound index.
- Schedule scroll handlers avoid layout writes outside animation frames.
- No scroll interaction creates a task longer than 50 ms in the standard fixture.
- Push batches stay under 100 mutations and 512 KB.
- Pull applies changes in bounded transactions.
- D1 list queries are indexed and never construct unbounded `IN (...)` lists.

## Rollout and observability

- Deploy to a new staging hostname and D1 database.
- Emit structured sync metrics: push count, duplicate count, retry class, pull lag, reset count and batch size.
- Never log recipe content, PINs, raw MCP keys, tokens, or mutation payloads.
- Run a minimum one-week staging burn-in across offline, multiple tabs, multiple profiles and two-device sync.
- Create fresh production D1/KV resources.
- Deploy the new service worker with distinct cache names.
- Switch the production custom domain only after release-gate acceptance.
- Keep the prototype branch and deployment recoverable during the initial production window.

## Explicit exclusions

Not part of this rewrite release:

- Migration of prototype D1 or IndexedDB data
- Grocery generation or purchase-state implementation
- Pantry inventory
- CRDTs or per-field vector clocks
- IndexedDB encryption
- Anonymous local profiles
- Multiple simultaneous WorkOS server sessions in one browser
- SSR data loaders for authenticated application routes
- Reusing prototype state, cache, route, or sync code

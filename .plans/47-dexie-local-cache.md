# #47 Add Dexie-backed local-first client cache foundation

## Summary
Build issue #47 on top of PR #53 by replacing fragile route-level in-memory caches with a typed, user-keyed Dexie/IndexedDB foundation. The schema should mirror existing server domain aggregates lazily: household, plan, menu, recipes, preferences, billing, sync metadata, and future outbox stores without eager localization or other users' data.

## Acceptance criteria
- [ ] A typed Dexie database module exists with explicit schema/versioning.
- [ ] The schema is user-keyed and household-scoped so future user switching does not require wiping all IndexedDB data.
- [ ] `/plan` and `/menu` hydrate from durable client cache before/while fresh server data arrives, without Svelte effect recursion.
- [ ] Cache writes are centralized behind small helper functions, not ad hoc in page effects.
- [ ] Stale/invalid cache behavior is defined with a TTL and schema version.
- [ ] Logout or missing active household does not leak prior household data into the UI.
- [ ] `pnpm check` passes.

## TODOs
- [x] Add Dexie dependency plus a typed, versioned client DB schema and pure tests for store/index contracts.
- [x] Replace in-memory route-data cache helpers with centralized Dexie read-through cache helpers and TTL/user/household isolation.
- [x] Wire `/plan`, `/menu`, and app layout to async durable cache hydration/clearing without recursive Svelte effects.
- [ ] Run focused validation and final repo checks.

## Notes
- 2026-06-19: Issue #47 is open. User explicitly wants this branch on top of PR #53 and wants a full Dexie schema based on existing DB schemas, lazily populated and user-keyed for future account switching.
- Svelte MCP server is unavailable in this runtime, so Svelte changes follow existing Svelte 5 project patterns and will be checked with `pnpm check`.
- Existing docs recommend IDB aggregate stores: households, householdMembers, recipes, plannedMeals, mealCheckIns, foodProfile, billingEntitlements, syncOutbox, syncCursors.
- 2026-06-19: Added `dexie` and a versioned client DB schema with user-keyed household aggregate stores, route caches, food profile, billing entitlement, sync cursor, and outbox stores.
- Validation: `pnpm vitest run src/lib/client-db/schema.test.ts` — pass.
- 2026-06-19: Replaced route data cache implementation with Dexie-backed async helpers. Route cache entries use `userId:householdId:route:*` keys and a six-hour TTL. Existing `$lib/stores/route-data-cache` now re-exports the centralized client DB helpers for compatibility.
- 2026-06-19: `/plan` and `/menu` initialize from server data, asynchronously hydrate fresh durable cache on mount without clearing authoritative data when no cache exists, and hydrate/clear on active-household changes. App layout writes active user/household metadata and removes inactive user data, while no-session layout deletes the client DB.
- Validation: `pnpm check` — pass.

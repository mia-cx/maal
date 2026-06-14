# Local-first PWA implementation plan

## Goal

Make Maal installable and useful without network access, with a full household-scoped local data copy in IndexedDB, optimistic offline writes, background sync to Cloudflare D1 when online, and sealed offline billing entitlements that require a remote refresh at the end of each subscription period.

## Non-goals

- Do not replace Cloudflare D1 as the canonical database.
- Do not introduce a hosted sync backend such as Convex.
- Do not attempt to make browser billing state cryptographically tamper-proof against a fully malicious local user. Browsers are user-controlled; the target is tamper-evident offline entitlement UX.
- Do not sync every DB table 1:1. Sync domain aggregates.
- Do not build collaborative realtime editing in this slice.

## Baseline already present

- PWA manifest exists at `static/manifest.webmanifest`.
- Service worker exists at `src/service-worker.ts` with app-shell/static/runtime GET caching.
- Architecture note exists at `docs/architecture/local-first-pwa.md`.
- Plan/menu currently have in-memory route caches in `src/lib/stores/route-data-cache.ts`.
- Server canonical data remains in D1 via Drizzle.

## Core decision: Dexie for browser persistence

Use Dexie for IndexedDB.

Reasons:

- Schema versioning and migrations are explicit.
- Transactions make `write local state + append sync operation` atomic.
- Indexed queries match household/date/menu access patterns.
- Bulk upserts/deletes make sync pulls cheap.
- It is easier to reason about than raw `idb` once an outbox, cursors, tombstones, and billing entitlement store exist.

Keep Drizzle server-only. Use explicit mappers between server DTOs and Dexie records.

## Data model

Create `src/lib/local-db/`.

### Files

- `src/lib/local-db/db.ts` — Dexie database definition and versioned stores.
- `src/lib/local-db/schema.ts` — local record types.
- `src/lib/local-db/mappers.ts` — server DTO ↔ local record mappers.
- `src/lib/local-db/outbox.ts` — enqueue/read/mark sync operations.
- `src/lib/local-db/cursors.ts` — sync cursor helpers.
- `src/lib/local-db/entitlements.ts` — signed billing entitlement persistence and verification result cache.
- `src/lib/local-db/index.ts` — public client API.

### Initial stores

Use domain aggregate stores rather than raw SQL table mirrors:

```ts
households: 'id, updatedAt, deletedAt'
householdMembers: 'id, householdId, userId, updatedAt, deletedAt'
recipes: 'id, householdId, title, updatedAt, deletedAt'
plannedMeals: 'id, householdId, date, status, updatedAt, deletedAt'
mealCheckIns: 'id, householdId, mealId, userId, updatedAt, deletedAt'
foodProfiles: 'householdId, updatedAt'
billingEntitlements: 'householdId, expiresAt, issuedAt'
syncOutbox: '++localId, householdId, status, createdAt, operationType, idempotencyKey'
syncCursors: 'scope'
```

Record conventions:

- Every synced record has `id`, `householdId` where applicable, `updatedAt`, and nullable `deletedAt` tombstone.
- Local-only metadata uses a `local` object or `local*` prefixed fields.
- Store remote payloads in client-friendly shapes already used by route components where possible.
- Avoid storing secrets. MCP keys should never be cached after one-time display.

## Sync protocol

Add a dedicated app route group for sync. Keep routes thin and push logic into server domain modules.

### Server files

- `src/routes/(app)/sync/pull/+server.ts`
- `src/routes/(app)/sync/push/+server.ts`
- `src/routes/(app)/sync/entitlement/+server.ts`
- `src/lib/server/sync/pull.ts`
- `src/lib/server/sync/push.ts`
- `src/lib/server/sync/operations.ts`
- `src/lib/server/sync/cursors.ts`
- `src/lib/server/sync/entitlements.ts`

### Pull endpoint

`GET /sync/pull?householdId=...&cursor=...&scope=plan,menu,household`

Returns:

```ts
{
  householdId: string;
  cursor: string;
  serverTime: string;
  records: {
    households: HouseholdRecord[];
    householdMembers: HouseholdMemberRecord[];
    recipes: RecipeRecord[];
    plannedMeals: PlannedMealRecord[];
    mealCheckIns: MealCheckInRecord[];
    foodProfiles: FoodProfileRecord[];
  };
  tombstones: TombstoneRecord[];
}
```

Cursor options:

1. Preferred: D1 change log table appended by all mutating services.
2. Simpler first slice: per-aggregate `updatedAt > cursorTime` plus tombstone tables/columns.

Start with `updatedAt` cursors only if all synced tables have reliable updated timestamps and deletes can be represented as tombstones.

### Push endpoint

`POST /sync/push`

Input:

```ts
{
  householdId: string;
  operations: SyncOperation[];
}
```

Each operation:

```ts
{
  idempotencyKey: string;
  operationType: 'recipe.create' | 'recipe.update' | 'recipe.delete' | 'meal.create' | 'meal.update' | 'meal.delete' | 'checkIn.upsert';
  baseVersion?: string;
  payload: unknown;
  createdAt: string;
}
```

Server behavior:

- Authenticate through existing app context.
- Verify household access and billing entitlement where required.
- Deduplicate by `idempotencyKey` in a sync operation receipts table.
- Apply operations in request order.
- Return per-operation results and a pull cursor.
- Do not partially fail the whole batch unless auth/access is invalid.

### Conflict rules

Define conflict handling per aggregate:

- Recipes: last-write-wins initially, then add field-level merge later if needed.
- Planned meals: conflict on same meal ID is last-write-wins; two offline creations are distinct records.
- Check-ins: merge by `mealId + userId`; latest verdict/reason wins.
- Household settings: require online in first local-first release, or block offline edits until conflict rules exist.
- Billing: server canonical only; local token only gates offline access.

## Billing entitlement sealing

Add signed entitlement tokens for offline access.

### Server endpoint

`GET /sync/entitlement?householdId=...`

Returns:

```ts
{
  token: string;
  payload: {
    userId: string;
    householdId: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
    canUsePaidFeatures: boolean;
    subscriptionPeriodEndsAt: string | null;
    issuedAt: string;
    expiresAt: string;
  };
}
```

### Signing

Use asymmetric signing so the browser can verify without a secret.

- Server secret: private key in Cloudflare secrets.
- Client config: public verification key bundled or fetched from a public endpoint with long cache.
- Algorithm: Ed25519 if Web Crypto support is acceptable; otherwise ECDSA P-256 for broader Web Crypto support.

Token expiry:

- Paid active subscription: `expiresAt = currentPeriodEnd`.
- Trial: `expiresAt = trialEndsAt`.
- Unpaid/none: short TTL or no offline paid access.
- Client must require online refresh after expiry.

Important caveat:

- This is tamper-evident, not tamper-proof. The browser can be modified. The goal is honest-user offline continuity and preventing trivial localStorage edits.

## Client runtime architecture

### Local read path

For each synced page:

1. Read local Dexie records immediately.
2. Render local data with an `offline/stale/syncing` indicator.
3. Trigger network revalidation when online.
4. Upsert server response into Dexie.
5. Update Svelte stores from Dexie live queries or explicit reload.

### Write path

For offline-capable mutations:

1. Validate at UI boundary.
2. Generate client ID/idempotency key.
3. Dexie transaction:
   - apply optimistic local record change
   - append pending outbox operation
4. Update UI immediately.
5. If online, schedule sync flush.

### Sync scheduler

Create `src/lib/sync/client.ts`:

- Listens to `online` events.
- Flushes outbox on app start when online.
- Pulls after successful push.
- Uses exponential backoff for transient failures.
- Surfaces permanent operation failures to a small sync status store.

Create `src/lib/stores/sync-status.ts`:

- `online`
- `syncing`
- `pendingOperationCount`
- `lastSyncedAt`
- `lastSyncError`
- `billingEntitlementStatus`

## Service worker strategy

Current service worker is app-shell oriented. Expand it carefully:

- Keep auth, billing, and MCP network-only.
- Cache static app assets aggressively by build version.
- Runtime GET cache can remain stale-while-revalidate for route shell responses.
- Do not depend on Cache Storage for canonical domain data; use Dexie for app data.
- Consider Background Sync API as optional progressive enhancement. Always support foreground sync on app open/online.

## Implementation phases

### Phase 1 — Foundation and installability

Deliverables:

- Add Dexie dependency.
- Add `src/lib/local-db` schema and typed DB wrapper.
- Add basic local DB tests for schema/open/migrations where practical.
- Add sync status store.
- Add small app-shell indicator for offline/sync status.

Validation:

- `pnpm check`
- `pnpm test:unit -- --run`
- `pnpm build`

### Phase 2 — Read-through local caches

Deliverables:

- Replace/augment `route-data-cache.ts` with Dexie-backed plan/menu caches.
- On `/plan`, read local planned meals immediately, then revalidate server data.
- On `/menu`, read local recipes immediately, then revalidate server data.
- Keep existing in-memory caches as short-lived facades if useful, but Dexie becomes durable source.

Validation:

- Unit tests for mappers and Dexie repository helpers.
- Browser test for route rendering with seeded IDB and offline network.

### Phase 3 — Pull sync

Deliverables:

- Add `/sync/pull` route.
- Add server pull service for menu + plan aggregates.
- Add client pull runner and cursor persistence.
- Add tombstone support for deleted recipes/meals.

Validation:

- Unit tests for cursor and mapper behavior.
- Integration-style server tests with mocked D1 where existing test patterns allow.

### Phase 4 — Offline mutations and outbox

Deliverables:

- Add sync operation types for recipe create/update/delete and meal create/update/delete.
- Add Dexie outbox helpers.
- Add `/sync/push` route and server operation dispatcher.
- Update menu/plan clients to enqueue offline-capable operations.
- Add conflict handling v1.

Validation:

- Unit tests for outbox transactions.
- Unit tests for idempotency behavior server-side.
- E2E: turn browser offline, create/edit recipe/meal, reload, go online, verify remote state updates.

### Phase 5 — Sealed billing entitlement

Deliverables:

- Add server entitlement signing service.
- Add `/sync/entitlement` route.
- Add client verifier using Web Crypto.
- Store token in Dexie.
- Gate offline paid access using verified token expiry.
- Refresh entitlement whenever online and active household changes.

Validation:

- Unit tests for payload expiry and status rules.
- Crypto tests for sign/verify if runtime test support permits.
- E2E: active token allows offline use; expired token requires online refresh.

### Phase 6 — Household/settings/local completeness

Deliverables:

- Add household settings/food profile pull support.
- Decide which household settings mutations can be offline.
- Add local display for members/invites where safe; invites likely online-only because links need server state.
- Add user-facing sync conflict/error UI.

Validation:

- E2E for fresh install, offline reload, household switch, and conflict recovery.

## Schema/server changes likely needed

- Add `updatedAt` consistency to all synced tables if missing.
- Add tombstone support or deleted-record log for synced deletes.
- Add sync idempotency receipts table:

```ts
syncOperationReceipts(
  idempotencyKey text primary key,
  userId text not null,
  householdId text not null,
  operationType text not null,
  resultJson text not null,
  createdAt integer not null
)
```

- Optional but recommended: add append-only change log:

```ts
syncChanges(
  id integer primary key autoincrement,
  householdId text not null,
  aggregateType text not null,
  aggregateId text not null,
  operation text not null,
  changedAt integer not null,
  payloadJson text
)
```

## UX requirements

- Offline state should be visible but not noisy.
- Pending local changes should show “Sync pending”.
- Failed sync should show actionable retry/details.
- Expired offline billing entitlement should explain: “Reconnect to refresh subscription access.”
- Household switching should read cached local data immediately per household.

## Testing plan

### Unit

- Local DB mappers.
- Outbox transaction helpers.
- Sync operation serializers.
- Conflict resolution functions.
- Entitlement expiry checks.
- Entitlement signature verification wrapper where possible.

### Browser/component

- Seed Dexie and render menu/plan from local data.
- Offline mutation enqueues operation and updates UI.
- Sync status store reacts to online/offline.

### Server

- Pull endpoint auth/access boundaries.
- Push endpoint idempotency.
- Operation dispatcher domain behavior.
- Entitlement signing payload rules.

### E2E

- Installable PWA smoke via manifest/service worker presence.
- Offline reload after initial online visit.
- Offline recipe edit then online sync.
- Offline meal planning then online sync.
- Expired entitlement blocks paid offline feature until online refresh.

## Risks

- Conflict resolution can become domain-specific quickly; keep v1 rules explicit and narrow.
- Service worker caching can mask server changes; domain data must live in Dexie, not only Cache Storage.
- Browser storage can be evicted; app should detect missing local DB and recover via pull.
- Signed billing token only protects against casual tampering, not a modified client.
- Full offline auth is limited by session cookie validity. Offline app use can continue with local data, but any server sync requires a valid online session.

## Suggested first PR slice

Implement Phase 1 only:

1. Add Dexie.
2. Add local DB schema.
3. Add sync status store.
4. Add tests for schema helpers/outbox enqueue.
5. Add docs explaining local store boundaries.

This creates the foundation without changing route behavior yet.

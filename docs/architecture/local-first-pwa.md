# Local-first PWA architecture

Maal should be installable and useful without a network connection, then converge with the Cloudflare D1 source of truth when connectivity returns.

## Scope

1. **PWA shell**: cache the app shell, static assets, and recent GET responses with a service worker.
2. **Local data copy**: keep the user's household-scoped data in IndexedDB for instant reads and offline writes.
3. **Sync log**: store local mutations as an append-only outbox, replay them to server endpoints when online, and reconcile server changes back into IDB.
4. **Sealed billing TTL**: allow offline use until the signed entitlement expires, then require a remote billing refresh.

## IndexedDB strategy

There is no first-party Drizzle driver that treats IndexedDB as a local mirror of the existing D1 schema. Drizzle is still the right server-side D1 abstraction, but the browser-side store should use an IndexedDB-first library such as Dexie or `idb` with explicit domain mappers.

Recommended shape:

- Keep D1 + Drizzle as the remote canonical database.
- Add an IDB schema whose stores match sync aggregate boundaries, not raw SQL tables:
  - `households`
  - `householdMembers`
  - `recipes`
  - `plannedMeals`
  - `mealCheckIns`
  - `foodProfile`
  - `billingEntitlements`
  - `syncOutbox`
  - `syncCursors`
- Reuse existing domain mappers where possible, but keep IDB schema migration versioned separately from D1 migrations.

## Sync protocol

The app should not blindly cache every route response and call it local-first. It needs a conflict-aware protocol:

1. Server exposes a household-scoped sync pull endpoint returning records changed after a cursor.
2. Client writes local mutations to IDB immediately and appends a sync operation to `syncOutbox`.
3. Background sync or an online event flushes outbox operations in order.
4. Server accepts idempotency keys for each operation.
5. Pull runs after push to resolve server-side canonical state.
6. Conflicts are resolved by domain rules, not table timestamps. Example: recipe text can be last-write-wins; meal check-ins may merge by user+meal.

## Sealed billing TTL

Client-side billing state cannot be truly tamper-proof because the user controls the browser. It can be tamper-evident enough for offline UX by storing a server-signed entitlement token.

Token payload:

```json
{
	"userId": "user_...",
	"householdId": "household_...",
	"status": "active",
	"subscriptionPeriodEndsAt": "2026-07-01T00:00:00.000Z",
	"issuedAt": "2026-06-01T00:00:00.000Z",
	"expiresAt": "2026-07-01T00:00:00.000Z"
}
```

Implementation notes:

- Sign on the server with a private key stored in Cloudflare secrets.
- Verify in the browser with a bundled public key using Web Crypto.
- Store only the signed token and verification result in IDB.
- Offline access is allowed until `expiresAt` / subscription period end.
- Once expired, paid features require a remote billing refresh.
- On every successful online billing check, replace the local token.

## Milestones

1. PWA installability and app-shell caching.
2. Read-through IDB caches for plan/menu/household views.
3. IDB-backed route stores with stale-while-revalidate reads.
4. Mutation outbox for recipes and planned meals.
5. Signed billing entitlement endpoint and client verifier.
6. Full household sync pull/push protocol.

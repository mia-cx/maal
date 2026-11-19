# WorkOS-backed sync entitlement

Research date: 2026-08-21

## Recommendation

Use the WorkOS Stripe Entitlements add-on as the authority for Maal's `sync` entitlement. Link each WorkOS organization to its Stripe customer. WorkOS then places the organization's Stripe entitlements in the AuthKit access token.

Do not issue a separate Maal sync-grant cookie. The WorkOS access token already supplies a signed, expiring, organization-scoped grant. A second cookie would duplicate expiry, rotation, organization switching, and revocation rules.

Keep the entitlement projection in Dexie for local UI decisions. Treat it as a cache only. Every sync endpoint must validate the WorkOS session and require the `sync` entitlement before it reads D1.

## What WorkOS can carry

WorkOS has a first-party Stripe Entitlements integration. It connects through Stripe Connect, associates a Stripe customer with a WorkOS organization, and places subscription-derived entitlements in that organization's users' access tokens. WorkOS states that the integration removes the need for the app to consume Stripe webhooks or persist entitlement state itself. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe)

The AuthKit access token is a WorkOS-signed JWT. Its standard claims include `sub`, `org_id`, `iat`, `exp`, and an optional `entitlements` array. A server can verify it with the application's WorkOS JWKS. [WorkOS session-token reference](https://workos.com/docs/reference/authkit/session-tokens)

Entitlements are organization-scoped. Maal should map one household to one WorkOS organization and authorize one active household per token. Switching households that need remote access means refreshing the session for the new `organization_id`. WorkOS only issues the new organization claims if the session user belongs to that organization. [WorkOS sessions](https://workos.com/docs/authkit/sessions)

WorkOS also supports organization or user metadata in custom JWT claims through JWT templates. Metadata does not appear in normal authentication responses unless a JWT template exposes it. This could carry a custom entitlement, but Maal would then need its own Stripe-to-WorkOS update path. The Stripe Entitlements claim is the simpler source. [WorkOS metadata](https://workos.com/docs/authkit/metadata), [WorkOS JWT templates](https://workos.com/docs/authkit/jwt-templates)

## Session and refresh flow

The AuthKit server session uses an encrypted, HTTP-only cookie that holds the access and refresh tokens. The server can unseal it, validate the current access token, and refresh it through WorkOS when needed. Refresh tokens can rotate, so each successful refresh must replace the sealed cookie. [WorkOS session helpers](https://workos.com/docs/reference/authkit/session-helpers)

WorkOS says a new Stripe entitlement appears after the next login or session refresh. It explicitly recommends a manual refresh after checkout. The refresh response includes both the new sealed session and the `entitlements` claim. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe)

The SvelteKit AuthKit integration handles expired-token refresh and cookie replacement. It preserves the current session on transient failures and redirects to sign-in only after a terminal session failure. An explicit post-checkout refresh can use the underlying session helper. [WorkOS session resilience](https://workos.com/docs/authkit/session-resilience)

## Maal request policy

1. On app launch, read the local entitlement projection from Dexie. Local features remain available with no request.
2. If `checkedAt` is still fresh, make no session request. If it is stale and the browser is online, call one lightweight session-refresh endpoint.
3. The endpoint reads the sealed AuthKit cookie, refreshes through WorkOS, replaces the rotated cookie, and returns a small projection: `userId`, `organizationId`, `entitlements`, `issuedAt`, and `expiresAt`.
4. The endpoint never opens D1. Dexie stores the returned projection and timestamp.
5. The checkout return forces this refresh once, regardless of the local freshness window. This makes a new subscription available without re-authentication.
6. The sync coordinator starts only when the local projection contains `sync`. The projection prevents free clients from making routine sync requests.
7. Every `/api/sync/*` route validates the live WorkOS session, checks `org_id` and `entitlements.includes("sync")`, then accesses D1. The check order guarantees that an unpaid request performs no D1 operation.

The freshness window is an application policy, not a WorkOS feature. A short AuthKit access-token lifetime limits how long a cancelled entitlement can remain valid. Maal can also force refresh before the first sync batch after a long offline period.

## Why not a separate sync-grant cookie

A separate signed HTTP-only cookie does not reduce D1 reads beyond the WorkOS token design. Both can reject free traffic before D1. The extra cookie adds another signing key, claim format, refresh endpoint, expiry policy, organization-switch path, and revocation delay.

The WorkOS token is enough for server authorization. Dexie's projection is enough for client scheduling and presentation. Keep those two roles separate.

## Implementation constraints

- Use a feature entitlement such as `sync`, not a Stripe plan name. Plans can change without application code changes.
- Never expose the sealed session or refresh token to browser JavaScript.
- Never trust Dexie's entitlement projection on a Worker route.
- Never use D1 to answer the lightweight session-refresh endpoint.
- Reject a token whose `org_id` does not match the requested household before any D1 access.
- Cache the WorkOS JWKS according to its HTTP cache policy so token verification does not become a per-request network dependency.
- Treat WorkOS or network failure as "keep the last local projection, do not start new sync." It must not block local use.

## One setup caveat

WorkOS currently requires a standard Stripe account connection for this add-on. It does not support connecting a Stripe Sandbox account. Development uses Stripe test mode on the connected standard account. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe)

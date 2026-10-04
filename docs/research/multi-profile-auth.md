# Multi-profile AuthKit sessions on one browser

Research date: 2026-08-21

## Recommendation

Use one **device-local auth slot per real WorkOS user**. Keep each WorkOS sealed session in its own persistent, HTTP-only cookie. Keep only the non-secret slot ID and profile projection in the shared Dexie database.

This is a custom session multiplexer around WorkOS, not a feature the stock AuthKit SvelteKit integration provides:

```text
Dexie profile
  workosUserId: user_...
  authSlotId: random opaque ID
  display identity, auth status, last successful refresh
                       |
                       | chooses a same-origin URL
                       v
/api/auth-slots/<slot>/...  <--- browser attaches only this slot's cookie
                       |
                       v
HTTP-only sealed WorkOS session
```

For example, slot `f83...` uses a cookie named `maal_session_f83...` with `Path=/api/auth-slots/f83.../`, `Secure`, `HttpOnly`, `SameSite=Lax`, and no `Domain`. Alice's retained session is not replaced when the local UI switches to Bob. A foreground coordinator, or later a service worker, can sync Alice by fetching Alice's slot URL even while Bob is the active UI profile.

The profile PIN remains a **local UI lock**, like a streaming-app profile PIN. It does not cryptographically lock the HTTP-only cookie. That limitation is consistent with the desired ability to synchronize Alice's pending household work while Bob is active.

Do not store a sealed session, refresh token, or access token in Dexie.

## What WorkOS supports

WorkOS models each sign-in as a session with its own `session_id`, and its API can list a user's active sessions and revoke one session by ID. This is sufficient for several independent real-user sessions to exist at WorkOS at once. [WorkOS Session API](https://workos.com/docs/reference/authkit/session)

The sealed-session helper accepts an arbitrary sealed session value plus the server-held cookie password. It does not require that value to have come from a particular cookie name. A successful refresh returns a replacement sealed session. This makes separate application-defined cookies technically viable. [WorkOS session helpers](https://workos.com/docs/reference/authkit/session-helpers)

However, WorkOS does **not document a first-class multi-account browser switcher**. The official web integration is oriented around one current session cookie. The current session toolkit and SvelteKit SDK each expose one configurable `cookieName` (default `wos-session`). [WorkOS session toolkit](https://github.com/workos/authkit-session), [WorkOS SvelteKit SDK](https://github.com/workos/authkit-sveltekit#configuration)

Therefore:

- Multiple sealed sessions are supported by the underlying session model and helpers.
- Multiple cookies and the mapping from a Maal profile to a cookie are Maal-owned behavior.
- "Add another profile" through Hosted AuthKit is not proven. The authorization API accepts `prompt`, `login_hint`, and `max_age`, and `max_age: 0` forces active authentication, but WorkOS does not say that this produces an account chooser or guarantees a different user from the hosted session already present. [WorkOS authorization URL](https://workos.com/docs/reference/authkit/authentication/get-authorization-url), [WorkOS reauthentication](https://workos.com/docs/authkit/reauthentication)

The Hosted AuthKit add-profile ceremony is consequently an integration-test gate. Start with `prompt=login`, `max_age=0`, and an optional `login_hint` for the intended second user. If Hosted AuthKit still forces the current identity, Maal will need either a WorkOS-supported account-switch parameter confirmed by support or a custom AuthKit UI/API flow. Do not solve it by revoking Alice merely to sign Bob in.

## Cookie layout and routing

Use a random, unguessable-looking slot ID as a routing handle, but do not treat it as authorization. The sealed session supplies identity; every server operation still authorizes the authenticated WorkOS `sub`, organization membership, entitlement, and requested data scope.

Suggested layout:

| Item           | Shape                                                       |
| -------------- | ----------------------------------------------------------- |
| Dexie slot key | `authSlotId` (128 bits of random data, base64url or hex)    |
| Cookie name    | `maal_session_<authSlotId>`                                 |
| Cookie path    | `/api/auth-slots/<authSlotId>/`                             |
| Cookie flags   | `Secure; HttpOnly; SameSite=Lax`; omit `Domain`             |
| Slot API       | `/api/auth-slots/<authSlotId>/{status,refresh,sync,remove}` |

Cookie `Path` makes the browser attach a slot cookie only to that slot's endpoint. It also keeps sealed sessions off app-shell and static-asset requests. RFC 6265 specifies path matching, while explicitly warning that `Path` is not a security boundary. [RFC 6265 path rules](https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1.2.4)

Use a distinct cookie name per slot. RFC 6265 warns servers not to depend on the order of same-named cookies with different paths. Distinct names avoid that ambiguity. [RFC 6265 Cookie semantics](https://www.rfc-editor.org/rfc/rfc6265.html#section-4.2.2)

The route's slot ID must match a strict length and character allow-list before it is used to derive a cookie name. Never accept a cookie name directly from a request header or body.

One slot represents one WorkOS user, not one user-household pair. WorkOS can switch the selected organization during refresh. Serialize refresh and organization-switch operations per slot so two household syncs cannot race one refresh token with different requested organizations. [WorkOS sessions and organization switching](https://workos.com/docs/authkit/sessions)

## What a service worker can and cannot do

A service worker cannot select an arbitrary HTTP-only cookie value and put it into a request:

- `Cookie` is a forbidden request header, so script cannot construct its own `Cookie` header. [Fetch Standard: forbidden request headers](https://fetch.spec.whatwg.org/#forbidden-request-header)
- The Cookie Store API exposes only script-visible cookies. An HTTP-only cookie is not script-visible, including in a service worker. [Cookie Store API](https://cookiestore.spec.whatwg.org/#cookie-concept)

It can select a slot **indirectly**. A same-origin `fetch('/api/auth-slots/f83.../sync')` has `same-origin` credentials by default, so the browser attaches the matching HTTP-only path cookie. [Fetch Standard: credentials mode](https://fetch.spec.whatwg.org/#concept-request-credentials-mode)

This is the same mechanism the foreground page should use. Neither actor reads credentials. Both know only the non-secret slot ID from Dexie and choose the corresponding URL.

Do not let the foreground page and service worker refresh or switch organizations for the same slot concurrently. WorkOS makes same-token refresh replays idempotent for 30 seconds, but a per-slot network lease is still needed because organization-switch requests can ask for different outcomes. [WorkOS session resilience](https://workos.com/docs/authkit/session-resilience)

For v1, the least risky order is:

1. Implement foreground profile-scoped sync first.
2. Use one Dexie-backed lease per auth slot to prevent concurrent sync actors.
3. Add service-worker sync only after the same test suite passes with the page closed.

## Rotation, expiry, switching, and removal

WorkOS rotates the refresh token on every successful refresh. Maal must overwrite that slot's cookie with the newly sealed session before the next operation. WorkOS gives a 30-second replay grace period: concurrent use of the just-rotated token returns the same replacement tokens. A replay outside the grace period returns terminal `invalid_grant`. [WorkOS session resilience](https://workos.com/docs/authkit/session-resilience)

Handle outcomes per slot:

- **Success:** replace only that slot's cookie.
- **Network, timeout, `429`, or `5xx`:** keep the existing cookie and retry with bounded backoff.
- **Terminal `invalid_grant`, revoked, or expired:** clear only that slot's cookie and mark its Dexie auth projection `reauthRequired`.
- **Local profile switch:** change `activeProfileId` in Dexie; do not touch any WorkOS session.
- **Remove from this device:** revoke that exact WorkOS session ID, clear exactly that slot cookie using the same Path attributes, and retain or delete the local profile/data according to the separate data-retention decision.

WorkOS's normal sign-out instructions delete the app session and redirect the browser through the hosted logout endpoint. It also exposes a server-side revoke-session API for a specific `session_id`. For a multiprofile device, test and prefer targeted revocation so removing Alice cannot disturb Bob's hosted or app session. [WorkOS signing out](https://workos.com/docs/authkit/sessions#signing-out), [WorkOS revoke session](https://workos.com/docs/reference/authkit/session#revoke-session)

Offline local use must not depend on cookie validity. A missing, evicted, or expired cookie changes only that profile's remote capability; it does not remove the profile or block its Dexie-backed UI.

## Cookie capacity

RFC 6265 asks general-purpose browsers to support at least 4,096 bytes per cookie, including name and attributes, and at least 50 cookies per domain. It also allows eviction and recommends that servers use few, small cookies. [RFC 6265 limits](https://www.rfc-editor.org/rfc/rfc6265.html#section-6.1)

Cloudflare currently accepts 128 KB of total request headers, but browser cookie limits are the earlier constraint. Path scoping means ordinary Maal requests and a selected slot request should carry zero or one sealed session rather than every retained session. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits)

Set a conservative v1 cap of **eight retained authenticated slots per browser installation**. This is a product guardrail, not a standards-derived maximum. Local profiles whose cookie has expired can remain visible and usable offline without counting as an active authenticated slot.

Before accepting the design, measure real sealed cookies from the worst claim set. The full `Set-Cookie` line for each must remain under 4,096 bytes in every target browser. If it does not, do not put the sealed blob in IndexedDB. First investigate a smaller server-sealed session format or carefully specified cookie chunking.

## Why credentials must not go in Dexie

IndexedDB is origin-scoped persistent storage available to scripts from that origin. The specification explicitly treats it as potentially sensitive and notes that pathname restrictions cannot protect it from same-origin script. [IndexedDB security and privacy](https://www.w3.org/TR/IndexedDB/#security)

A WorkOS sealed session is encrypted, but it is still a replayable bearer artifact: an attacker does not need to decrypt it if they can copy it into a request to Maal, where the server will unseal it. Storing it in Dexie would expose it to any same-origin XSS and to application/service-worker code, defeating the main benefit of `HttpOnly`. WorkOS recommends keeping refresh tokens in backend storage or a secure HTTP-only cookie. [WorkOS sessions](https://workos.com/docs/authkit/sessions)

The optional profile PIN does not fix this. A short PIN is vulnerable to offline guessing if used to encrypt a credential, and same-origin malicious script could use an already-unlocked credential or cryptographic key. Keep the PIN's promise narrow: it prevents casual household members from opening another profile through the normal UI.

Dexie may store:

- auth slot ID;
- WorkOS user ID and safe display fields;
- local PIN verifier and lock policy;
- `authenticated`, `stale`, or `reauthRequired` projection;
- last successful refresh time and non-authoritative entitlement projection;
- sync cursors and outbox ownership.

Dexie must not store access tokens, refresh tokens, sealed sessions, cookie encryption keys, or logout URLs containing session identifiers.

## Routine zero-D1-cost behavior for free users

This design needs no Maal server-side session table, KV object, or D1 row. WorkOS owns its session record, while the browser holds the server-sealed session cookie and Dexie holds the non-secret profile projection.

The local application boots and switches profiles entirely from Dexie. It does not call a Maal sync endpoint for a free profile. Explicit sign-in, add-profile, reauthentication, checkout, and a deliberately scheduled stale-session refresh may call WorkOS through Maal's Worker, but those routes do not access D1. Paid sync routes validate the selected sealed session and entitlement before touching D1.

This preserves the intended content-use boundary: booting, switching profiles, and using recipes, meals, check-ins, preferences, and taxonomy produce no D1 operations and no routine sync traffic. A later Wayfinder decision explicitly permits Maal's custom invite-code administration to use D1 for free households.

## Required browser and integration test matrix

Run against a real WorkOS staging environment and the actual deployed Cloudflare Worker. Use Chrome, Firefox, desktop Safari, and iOS Safari. Android Chrome should be included for the kitchen-display use case. Record the browser, OS, WorkOS session IDs, cookie byte sizes, request Cookie header names, and whether D1 was opened.

| Case                      | Setup and action                                                                                                   | Required result                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First profile             | Sign Alice in and create a new auth slot.                                                                          | One Alice sealed-session cookie exists at Alice's exact slot Path; Dexie contains only the non-secret slot projection.                                                                                     |
| Hosted add-profile gate   | While Alice remains signed in, add Bob using `prompt=login`, `max_age=0`, and then with/without `login_hint`.      | Bob can actively authenticate and produce a distinct WorkOS session without revoking or overwriting Alice. Failure blocks the Hosted AuthKit approach and triggers WorkOS support/custom-UI investigation. |
| Local switch offline      | Go offline and switch Alice -> Bob -> Alice, with and without PINs.                                                | UI switches immediately from Dexie; no Worker or WorkOS request occurs; no cookie is changed.                                                                                                              |
| Cookie path selection     | With Alice and Bob retained, request app assets, Alice's slot status route, and Bob's slot status route.           | Assets carry neither sealed session. Each slot route carries exactly its own named session cookie.                                                                                                         |
| Identity binding          | Tamper the URL slot ID, Dexie `workosUserId`, and request body owner ID.                                           | The Worker trusts only the unsealed `sub`; mismatches fail before D1.                                                                                                                                      |
| Inactive-user sync        | Make Bob active, then enqueue an Alice-owned paid sync operation and run the foreground coordinator.               | The request uses Alice's slot, authenticates as Alice, and leaves Bob's session untouched.                                                                                                                 |
| Household sync actor      | Bob active; upload an Alice-authored household mutation with Alice's retained session.                             | Server records Alice as submitter and authorizes current household membership; active UI profile is irrelevant.                                                                                            |
| Organization switching    | Give Alice two households and alternate sync batches. Also trigger two different household batches concurrently.   | Serialized requests receive the correct `org_id`; the lease prevents cross-organization refresh races.                                                                                                     |
| Concurrent refresh        | Expire Alice's access token and issue two same-slot requests within 30 seconds from two tabs.                      | Both converge on the same rotated session; neither Alice nor Bob is signed out.                                                                                                                            |
| Transient refresh failure | Inject timeout, `429`, and `503` responses.                                                                        | Existing cookie remains; slot becomes temporarily stale; local app continues; bounded retry occurs.                                                                                                        |
| Terminal refresh failure  | Revoke Alice's session, then refresh Alice while Bob remains valid.                                                | Only Alice's cookie is cleared and Alice becomes `reauthRequired`; Bob and all local data remain usable.                                                                                                   |
| Remove one profile        | Remove Alice from the device.                                                                                      | Alice's exact session is revoked, Alice's cookie is cleared with matching Path, and Bob's app and hosted sessions remain active.                                                                           |
| Hosted logout isolation   | Exercise WorkOS hosted logout for Alice while Bob is retained.                                                     | Determine whether the hosted-domain cookie/account state affects adding or refreshing Bob. Do not ship a multiprofile "sign out" flow until this is known.                                                 |
| Service-worker selection  | From the service worker, fetch Alice's slot route while Bob is active. Attempt to read/set the HTTP-only cookie.   | Browser attaches Alice's cookie to the selected path; worker script cannot read the cookie value or set `Cookie`; Bob's cookie is absent.                                                                  |
| Page/SW collision         | Start foreground and service-worker sync for the same slot.                                                        | Exactly one obtains the Dexie lease; the other defers. No organization switch or refresh runs concurrently.                                                                                                |
| Offline restart           | Retain two profiles, close browser, start offline after access-token expiry.                                       | App and local profile switcher work; no profile is deleted; remote state reads `stale` until online revalidation.                                                                                          |
| Free cost boundary        | Use a free multiprofile household through boot, switch, edit, close, and reopen online.                            | Zero sync requests and zero D1 queries. Static app delivery and explicit authentication are the only network activity.                                                                                     |
| Paid boundary             | Enable paid remote features for one household, with another free household on the same users.                      | Only eligible queued work starts sync; every request authenticates the correct slot and checks entitlement before D1.                                                                                      |
| Cookie size               | Use the largest realistic user object, roles, permissions, entitlements, and metadata. Inspect every `Set-Cookie`. | Each complete cookie remains below 4,096 bytes and survives restart in every target browser.                                                                                                               |
| Slot capacity             | Fill eight authenticated slots, complete a concurrent PKCE add-profile flow, restart, and refresh each slot.       | No session or verifier cookie is evicted. A ninth retained auth slot is rejected by Maal UI with an actionable remove-profile path.                                                                        |
| XSS storage assertion     | Inspect `document.cookie`, Cookie Store, IndexedDB, Cache Storage, logs, and error reports.                        | No access token, refresh token, or sealed session is script-readable or logged.                                                                                                                            |

## Decision status

The stateless cookie-per-profile architecture is suitable for Maal v1 **if and only if** these two gates pass:

1. Hosted AuthKit can actively authenticate a second real user without destroying the first user's retained WorkOS session.
2. Worst-case sealed sessions fit reliably in one cookie on every supported browser.

Everything else follows documented WorkOS session primitives and browser cookie/fetch behavior. Until those two real tests pass, retain this as the preferred design rather than a locked implementation fact.

# Retained WorkOS auth-slot proof

Status on 2026-08-21: local browser contract passed. Hosted AuthKit passed with disposable WorkOS staging users in Chromium and Firefox. Native Safari and iOS Safari remain open.

## What is proven locally

- The installed WorkOS Node SDK accepts `provider=authkit`, `prompt=login`, `max_age=0`, and `login_hint` together.
- Secure HTTP-only cookies with exact slot paths select Alice or Bob without sending the other sealed session.
- App assets receive no slot session cookie.
- Auth-slot projections discard access tokens, refresh tokens, and sealed sessions.
- The local guard rejects a ninth authenticated slot.
- The server rejects a sealed-session cookie whose complete serialized size reaches 4,096 bytes.
- PIN reauthentication binds the callback to the original WorkOS user through a signed HTTP-only identity cookie.

## WorkOS staging result

The direct WorkOS SDK proof created disposable Alice and Bob users, authenticated both, refreshed Alice, revoked Alice's exact session, and refreshed Bob again. Both complete serialized cookies measured 2,226 bytes. The script deleted both users in `finally`.

The Hosted AuthKit proof then repeated the flow through the real staging login UI with `prompt=login`, `max_age=0`, and Bob's `login_hint` in the same browser context:

| Browser      | Alice cookie |  Bob cookie | Alice survived Bob login | Bob survived Alice revocation |
| ------------ | -----------: | ----------: | ------------------------ | ----------------------------- |
| Chromium 149 |  2,269 bytes | 2,248 bytes | yes                      | yes                           |
| Firefox 151  |  2,269 bytes | 2,269 bytes | yes                      | yes                           |

The WorkOS staging API key, client ID, and cookie password came from an ignored file outside this worktree. The proof never copied or printed them. Every proof run deleted its disposable users.

Run the local checks with:

```sh
pnpm test:unit -- tests/unit/auth-slots.spec.ts
pnpm exec playwright test tests/e2e/auth-slot-cookies.e2e.ts
```

Run the disposable WorkOS proofs only with a test API key:

```sh
pnpm test:proof:auth-slots:api
pnpm test:proof:auth-slots:hosted
AUTH_SLOT_PROOF_BROWSER=firefox pnpm test:proof:auth-slots:hosted
```

Both scripts refuse to create users unless `WORKOS_API_KEY` starts with `sk_test_`.

## Remaining browser gate

Deploy this branch to the WorkOS staging application, set the five `AUTH_SLOT_PROOF_*` variables from `.env.example`, install the Playwright browsers, then run the full route proof:

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:proof:auth-slots
```

The route proof signs Alice in, adds Bob with a forced active Hosted AuthKit login, compares their WorkOS identities, measures both real sealed cookies, refreshes Alice, signs Alice out, reauthenticates Alice, removes Alice, and confirms Bob remains authenticated throughout.

Playwright WebKit could not launch here because the host lacks `libgtk-4`, `libavif`, `libmanette`, `libenchant`, `libsecret`, and `libwoff2dec`, and sudo is unavailable. WebKit and device profiles would still be engine checks, not native Safari proof. Before closing issue #58, repeat the deployed flow on native desktop Safari and one real iOS Safari device. Record browser versions, both WorkOS session IDs, cookie byte counts, and request cookie names without recording cookie values.

If Bob's Hosted AuthKit login replaces or revokes Alice, stop. Implement the custom WorkOS Authentication API UI, then run the same gate unchanged against that login surface.

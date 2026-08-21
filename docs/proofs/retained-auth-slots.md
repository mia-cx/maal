# Retained WorkOS auth-slot proof

Status on 2026-08-22: the local contract and WorkOS staging checks pass in Chromium and Firefox. Native macOS Safari, iOS Safari, and Android Chrome remain open in issue #70.

## Proven behavior

- Each profile uses an independent, host-only, path-scoped sealed-session cookie.
- The callback's actual `Set-Cookie` line stays below 4,096 bytes and includes `Secure`, `HttpOnly`, `SameSite=Lax`, and the exact slot path.
- Alice remains valid after Bob signs in. Bob remains valid after Alice refreshes, signs out, reauthenticates, and leaves the device.
- The route proof uses `context.request`, which shares the browser context's cookie jar.
- Each live run creates unique WorkOS staging users. Cleanup verifies each deleted user no longer resolves or appears in an email-filtered user list.
- Proof output contains cookie names and byte counts. It never writes cookie values, credentials, authorization codes, or sealed sessions.

The direct WorkOS SDK proof measured 2,226-byte Alice and Bob cookies. Hosted AuthKit measured 2,248 to 2,269 bytes in Chromium 149 and Firefox 151.

## Local and staging commands

Run the local contract checks:

```sh
pnpm exec vitest run tests/unit/auth-slots.spec.ts tests/unit/auth-slot-proof-evidence.spec.ts
pnpm exec playwright test tests/e2e/auth-slot-cookies.e2e.ts
```

Run the disposable WorkOS proofs only with a test API key:

```sh
pnpm test:proof:auth-slots:api
pnpm test:proof:auth-slots:hosted
AUTH_SLOT_PROOF_BROWSER=firefox pnpm test:proof:auth-slots:hosted
```

Run the deployed route proof with `AUTH_SLOT_PROOF_BASE_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD` set. The harness creates and removes Alice and Bob itself:

```sh
pnpm test:proof:auth-slots
```

Every Playwright project starts with `supplemental-`. Linux WebKit and device descriptors are engine checks only. They do not satisfy issue #70. Traces, screenshots, and videos stay disabled because they can retain credentials and cookies.

## Native evidence adapter

Create one private template per real target:

```sh
pnpm proof:auth-slots:evidence init native-macos-safari /tmp/maal-macos-safari.json
pnpm proof:auth-slots:evidence init native-ios-safari /tmp/maal-ios-safari.json
pnpm proof:auth-slots:evidence init native-android-chrome /tmp/maal-android-chrome.json
```

For each native target, create a fresh Alice and Bob through the WorkOS staging API. The command writes credentials only to a new mode-`0600` file and prints no credential. Do not reuse the pair on another target:

```sh
pnpm proof:auth-slots:evidence fixtures-create /tmp/maal-auth-slot-fixtures.json
```

Use Safari Web Inspector, Chrome remote debugging, or a trusted real-device runner. Record the exact hardware, OS, and browser versions. Run Alice, then Bob, then Alice refresh, targeted Alice sign-out, Alice reauthentication, and Alice removal. Confirm Bob after each Alice operation.

Use these fixed slots on the staging origin:

```text
Alice: 00112233445566778899aabbccddeeff
Bob:   ffeeddccbbaa99887766554433221100
```

Open `/api/auth-slots/<slot>/authorize?purpose=add-profile&loginHint=<email>&returnTo=/` for each initial login. Use `purpose=reauthenticate` for Alice's second login. Invoke refresh, sign-out, and removal from the staging-origin console with `fetch` requests to the matching slot route. Never paste credentials or response headers into the console.

Use these console calls in sequence, checking Bob's returned `workosUserId` after each Alice operation:

```js
await fetch('/api/auth-slots/00112233445566778899aabbccddeeff/refresh', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: '{}'
}).then((response) => response.json());
await fetch('/api/auth-slots/ffeeddccbbaa99887766554433221100/').then((response) =>
	response.json()
);
await fetch('/api/auth-slots/00112233445566778899aabbccddeeff/sign-out', { method: 'POST' });
await fetch('/api/auth-slots/ffeeddccbbaa99887766554433221100/').then((response) =>
	response.json()
);
await fetch('/api/auth-slots/00112233445566778899aabbccddeeff/', { method: 'DELETE' });
await fetch('/api/auth-slots/ffeeddccbbaa99887766554433221100/').then((response) =>
	response.json()
);
```

Copy the exact `Set-Cookie` header value for Alice's initial login, Bob's initial login, Alice's refresh, and Alice's reauthentication into separate private temporary files. Do not include the `Set-Cookie:` field name. Sanitize each value through stdin:

```sh
pnpm proof:auth-slots:evidence inspect-cookie <32-character-slot-id> < /tmp/private-set-cookie.txt
```

The command emits only the cookie name, exact header-value byte count, and required attributes. Paste the four safe objects into the target template, then delete the raw files. Record request cookie names only for one app asset and both slot routes. Check Cloudflare telemetry for whether D1 opened during the proof window.

After the flow, revoke its sessions and remove both users. This command calls `deleteUser`, polls `getUser` and the email-filtered user list until both users are absent, prints sanitized cleanup evidence, and removes the private credential file only after success:

```sh
pnpm proof:auth-slots:evidence fixtures-cleanup /tmp/maal-auth-slot-fixtures.json
```

Record zero disposable users remaining in each target evidence file. If cleanup fails, the private file remains available for a retry.

Validate each file, then the complete matrix:

```sh
pnpm proof:auth-slots:evidence validate /tmp/maal-macos-safari.json
pnpm proof:auth-slots:evidence validate-matrix \
  /tmp/maal-macos-safari.json \
  /tmp/maal-ios-safari.json \
  /tmp/maal-android-chrome.json
```

The validator rejects incomplete checks, cookie-policy failures, missing cleanup, template placeholders, and fields that could hold credentials or raw authentication material.

## Remaining external action

Run the matrix on native macOS Safari, a real iPhone or iPad, and a real Android device. A resized browser, Playwright WebKit, or device descriptor does not count. Issue #70 stays open until all three private evidence files validate and their safe facts are recorded.

# Retained WorkOS auth-slot proof

Status on 2026-08-22: the local contract and WorkOS staging checks pass in Chromium and Firefox. Native macOS Safari, iOS Safari, and Android Chrome remain open in issue #70.

## Proven behavior

- Each profile uses an independent, host-only, path-scoped sealed-session cookie.
- Every authorization uses the one registered `/api/auth/callback` URI. The retained slot never appears in WorkOS's redirect URI.
- Encrypted state binds the slot, purpose, expected user, safe return path, nonce, issue time, and ten-minute expiry.
- A short-lived HTTP-only nonce marker makes the callback one-use without merging concurrent Alice and Bob flows.
- The callback's actual `Set-Cookie` line stays below 4,096 bytes and includes `Secure`, `HttpOnly`, `SameSite=Lax`, and the exact slot path.
- Alice remains valid after Bob signs in. Bob remains valid after Alice refreshes, signs out, reauthenticates, and leaves the device.
- The route proof uses `context.request`, which shares the browser context's cookie jar.
- Each live run creates unique WorkOS staging users. Cleanup verifies each deleted user no longer resolves or appears in an email-filtered user list.
- Proof output contains cookie names and byte counts. It never writes cookie values, credentials, authorization codes, or sealed sessions.

The direct WorkOS SDK proof measured 2,226-byte Alice and Bob cookies. Hosted AuthKit measured 2,248 to 2,269 bytes in Chromium 149 and Firefox 151.

## Local and staging commands

Run the local contract checks:

```sh
pnpm exec vitest run tests/unit/auth-slots.spec.ts tests/unit/auth-authorize-route.spec.ts tests/unit/auth-callback-route.spec.ts tests/unit/auth-slot-proof-evidence.spec.ts
pnpm exec playwright test tests/e2e/auth-slot-cookies.e2e.ts
```

Run the disposable WorkOS proofs only with a test API key:

```sh
pnpm test:proof:auth-slots:api
pnpm test:proof:auth-slots:hosted
AUTH_SLOT_PROOF_BROWSER=firefox pnpm test:proof:auth-slots:hosted
```

Run the deployed route proof with `AUTH_SLOT_PROOF_BASE_URL`, `AUTH_SLOT_PROOF_REDIRECT_URI`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD` set. The harness creates and removes Alice and Bob itself:

```sh
pnpm test:proof:auth-slots
```

Register exactly `<deployed origin>/api/auth/callback` in the WorkOS application. Set `AUTH_SLOT_PROOF_REDIRECT_URI` to that same URI.

Every Playwright project starts with `supplemental-`. Linux WebKit and device descriptors are engine checks only. They do not satisfy issue #70. Traces, screenshots, and videos stay disabled because they can retain credentials and cookies.

## Native procedure (issue #70)

Run one target at a time on real hardware. Mia's Mac is the operator host for all three, because the iOS and Android inspectors run there. Plan 10 minutes of setup per inspector, then 25 to 35 minutes per target.

| Target                  | Device                         | Inspector                                  |
| ----------------------- | ------------------------------ | ------------------------------------------ |
| `native-macos-safari`   | A real Mac, shipped Safari     | Safari Web Inspector on the same Mac       |
| `native-ios-safari`     | A real iPhone or iPad          | Mac Safari > Develop > device              |
| `native-android-chrome` | A real Android phone or tablet | Desktop Chrome `chrome://inspect` over USB |

`init` writes a template with every check, `d1Opened`, and cleanup fact unset. `validate` fails until the procedure below fills each one from an observation.

### 0. Lead: deploy and preflight

Deploy the candidate to `maal-staging` with the WorkOS secrets set, and register `https://staging.maal.is/api/auth/callback` in WorkOS staging with Hosted AuthKit password sign-in on. Then confirm the routes and the D1 telemetry:

```sh
curl -s https://staging.maal.is/api/auth-slots/00112233445566778899aabbccddeeff/
# expect: {"schemaVersion":1,"authSlotId":"0011...eeff","status":"reauthRequired"}
curl -s -o /dev/null -D - -H 'x-maal-proof-trace: issue70-preflight' \
  https://staging.maal.is/api/auth-slots/00112233445566778899aabbccddeeff/ | grep -i x-maal-proof
# expect: x-maal-proof-d1-opened: false
```

Hand the operator the 40-character candidate SHA and a non-secret deployment label, such as the Worker version ID.

### 1. Mac, once: operator shell

```sh
[ -n "$ZSH_VERSION" ] && setopt interactivecomments
cd <maal checkout> && git fetch origin && git switch --detach <CANDIDATE_SHA> && pnpm install --frozen-lockfile
export WORKOS_API_KEY=...        # sk_test_ staging key from your secret store; never echo it
export WORKOS_CLIENT_ID=...
export CANDIDATE_SHA=<40-char sha> DEPLOY_LABEL='<non-secret label>' ORIGIN=https://staging.maal.is
export P="$HOME/.cache/maal-proofs/70-private"; mkdir -p "$P"; chmod 700 "$P"
export A=00112233445566778899aabbccddeeff B=ffeeddccbbaa99887766554433221100
ev() { pnpm -s proof:auth-slots:evidence "$@"; }
cookie_names() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s.replace(/^cookie:\s*/i,"").split(";").map(p=>p.split("=")[0].trim()).filter(Boolean).sort())))'; }
```

### 2. Per target: prepare

Each target gets a fresh Alice and Bob. Never reuse a pair.

```sh
export T=native-macos-safari     # or native-ios-safari, native-android-chrome
unset CALLBACK_OK FLOW_ONE_USE_OK AUTH_SLOT_PROOF_D1_OPENED
ev init "$T" "$P/$T.template.json"
ev fixtures-create "$P/$T.fixtures.json"
export RUN_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
node -e 'const f=require(process.argv[1]);const s={alice:process.env.A,bob:process.env.B};const url=(slot,purpose,email)=>`${process.env.ORIGIN}/api/auth-slots/${slot}/authorize?purpose=${purpose}&loginHint=${encodeURIComponent(email)}&returnTo=/`;for(const u of f.users)console.log(u.label,url(s[u.label],"add-profile",u.email));console.log("alice-reauth",url(s.alice,"reauthenticate",f.users[0].email))' "$P/$T.fixtures.json"
jq -r '.users[0].password' "$P/$T.fixtures.json"   # both users share it; type it on the device, never into a console
```

Open the inspector:

- **macOS Safari**: Safari > Settings > Advanced > "Show features for web developers". Open the staging origin and press Option-Command-I.
- **iOS/iPadOS Safari**: on the device, turn on Settings > Apps > Safari > Advanced > Web Inspector. Connect by cable and trust the Mac. Open the staging origin, then choose Safari > Develop > <device> > the staging tab on the Mac.
- **Android Chrome**: turn on Developer options and USB debugging, connect by cable, and accept the RSA prompt. Open the staging origin, then click "inspect" on it in desktop Chrome at `chrome://inspect/#devices`.

In Network, turn on Preserve Log and Disable Cache. Decline every "save password" prompt. Navigate the device from the inspector console with `location.assign('<url>')`. Clear the clipboard with `pbcopy </dev/null` after each paste below.

Before the first authorization, clear the previous helper state and set a fresh, non-secret trace label in the staging-origin console:

```js
sessionStorage.removeItem('issue70');
var proofLabel = `issue70-${crypto.randomUUID()}`;
document.cookie = `maal_proof_trace=${proofLabel}; Path=/; Secure; SameSite=Lax`;
proofLabel;
```

Give this label to the lead. With `MAAL_PROOF_TELEMETRY=staging-only`, this cookie traces all Worker-served requests from the device, including authorization, callback, document navigations, and application-generated fetches. The cookie holds no authentication material and is ignored outside staging telemetry. The lead opens Workers Logs for `maal-staging` and checks `staging_proof_request` events with this exact `proofLabel` over the full run window. Logs must be unsampled and complete; missing events or a dropped tail connection leave the observation unset. Do not export raw request logs or callback URLs.

### 3. Per target: record versions

- **macOS**: `sw_vers`, `sysctl -n hw.model`, and `defaults read /Applications/Safari.app/Contents/Info CFBundleShortVersionString`.
- **iOS/iPadOS**: Settings > General > About for the model and OS build. Safari's version is the UA's `Version/x.y`.
- **Android**: Settings > About phone for the model and Android build. Chrome's version is on `chrome://version`.
- **All**: `navigator.userAgent` in the inspector console. Take OS versions from the OS, not the UA: Safari freezes macOS at `10_15_7`, and Chrome hides the Android version.

```sh
export HW='<hardware model>' OS_NAME='<macOS|iOS|iPadOS|Android>' OS_VERSION='<version (build)>'
export BROWSER_NAME='<Safari|Chrome>' BROWSER_VERSION='<exact version>' UA='<navigator.userAgent>'
```

### 4. Per target: run the flow

Paste this helper into the staging-origin console, and again after every page load. Its state lives in `sessionStorage` and survives the WorkOS round trip. Its D1 aggregate covers only helper fetches and is a cross-check, not the full-run observation; the lead must include the native navigations and application requests using the trace label above.

```js
var P = {
	A: '00112233445566778899aabbccddeeff',
	B: 'ffeeddccbbaa99887766554433221100',
	s: JSON.parse(
		sessionStorage.getItem('issue70') ?? '{"checks":{},"d1Opened":false,"telemetry":true}'
	),
	async call(path, method = 'GET', body) {
		const response = await fetch(path, {
			method,
			body,
			headers: {
				...(body ? { 'content-type': 'application/json' } : {})
			}
		});
		const d1 = response.headers.get('x-maal-proof-d1-opened');
		if (d1 !== 'true' && d1 !== 'false') this.s.telemetry = false;
		if (d1 === 'true') this.s.d1Opened = true;
		return {
			http: response.status,
			json: response.status === 204 ? null : await response.json().catch(() => null)
		};
	},
	async who(slot) {
		const { http, json } = await this.call(`/api/auth-slots/${slot}/`);
		return { http, status: json?.status, user: json?.workosUserId };
	},
	pass(name, ok) {
		this.s.checks[name] = ok === true;
		sessionStorage.setItem('issue70', JSON.stringify(this.s));
		console.log(`${name}: ${ok === true ? 'PASS' : 'FAIL'}`);
	}
};
```

Stop at the first FAIL, and run step 5 anyway.

**Flow observations, for each of the three logins.** Inspect the authorization response and outbound WorkOS URL privately in Network. Confirm the registered `redirect_uri` is exactly `https://staging.maal.is/api/auth/callback`. The state must have the opaque `v1.<base64url IV>.<base64url ciphertext>` format, with a 16-character IV segment, not plaintext JSON or visible slot, purpose, expected-user, or return-path fields. The local flow tests establish encryption; this native observation checks the deployed wire format. Confirm the authorization response sets a fresh `__Secure-maal_auth_flow_<nonce>` marker with value `pending`, `Path=/api/auth/callback`, `Secure`, `HttpOnly`, `SameSite=Lax`, and a ten-minute lifetime. Do not copy state or cookie values into a console, shell, file, or report.

**Callback and replay observations, after every login.** In Network, the `/api/auth/callback` 303 has no slot in its path, and its `Location` is `/?authSlot=<slot>&authStatus=authenticated`. Confirm the matching flow marker is deleted. After capturing the original callback's cookies, use the inspector's resend/replay request action on that exact callback with the browser's current cookies, not the original saved `Cookie` header. It must return 400 and set no replacement session or identity cookies. Confirm all already-bound retained identities are unchanged after replay. Return to `/` and re-paste the helper if replay navigated the page. If the inspector cannot replay using current cookies, stop and ask the lead for a private intercepting-proxy replay; do not substitute cookie disappearance for replay rejection. Set `CALLBACK_OK` and `FLOW_ONE_USE_OK` in step 4.7 only after all three logins satisfy their respective observations.

**Cookie captures.** From the callback 303, copy one `Set-Cookie` value without the field name, and pipe it through `ev inspect-cookie`. It prints only the cookie name, byte count, and attributes. It rejects a wrong Path, a missing `Secure` or `HttpOnly`, anything but `SameSite=Lax`, a `Domain`, and 4,096 bytes or more.

**4.1 Alice signs in.** `location.assign('<alice URL>')`, then sign in on the device. Capture both of Alice's cookies:

```sh
pbpaste | ev inspect-cookie "$A" > "$P/$T.aliceInitial.json" && cat "$P/$T.aliceInitial.json"; pbcopy </dev/null              # __Secure-maal_session_0011...
pbpaste | ev inspect-cookie "$A" --identity > "$P/$T.aliceIdentity.json" && cat "$P/$T.aliceIdentity.json"; pbcopy </dev/null  # __Secure-maal_identity_0011...
```

```js
var a = await P.who(P.A);
P.s.alice = a.status === 'authenticated' ? a.user : null;
P.pass('_aliceSignedIn', P.s.alice !== null);
```

**4.2 Bob signs in.** `location.assign('<bob URL>')`, sign in, then:

```sh
pbpaste | ev inspect-cookie "$B" > "$P/$T.bobInitial.json" && cat "$P/$T.bobInitial.json"; pbcopy </dev/null
pbpaste | ev inspect-cookie "$B" --identity > "$P/$T.bobIdentity.json" && cat "$P/$T.bobIdentity.json"; pbcopy </dev/null
```

```js
var a = await P.who(P.A),
	b = await P.who(P.B);
P.s.bob = b.status === 'authenticated' ? b.user : null;
P.pass('distinctIdentities', P.s.bob !== null && P.s.bob !== P.s.alice);
P.pass('aliceSurvivedBobLogin', a.status === 'authenticated' && a.user === P.s.alice);
```

**4.3 Request cookie names.** Print a cache-busted asset URL:

```js
var el = document.querySelector(
	'script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]'
);
var u = new URL(el.getAttribute('src') ?? el.getAttribute('href'), location.origin);
u.searchParams.set('auth-slot-proof', crypto.randomUUID());
u.href;
```

Navigate to that URL, then to `/api/auth-slots/<alice>/`, then to `/api/auth-slots/<bob>/`. After each, copy the document request's `Cookie` header value and run the matching line. With no `Cookie` header, write `[]`:

```sh
pbpaste | cookie_names > "$P/$T.names.appAsset.json";  cat "$P/$T.names.appAsset.json";  pbcopy </dev/null   # or: echo '[]' > ...
pbpaste | cookie_names > "$P/$T.names.aliceSlot.json"; cat "$P/$T.names.aliceSlot.json"; pbcopy </dev/null
pbpaste | cookie_names > "$P/$T.names.bobSlot.json";   cat "$P/$T.names.bobSlot.json";   pbcopy </dev/null
```

Each slot route must list exactly its own session and identity cookies. Then `location.assign('/')` and re-paste the helper.

**4.4 Targeted refresh.**

```js
var r = await P.call(`/api/auth-slots/${P.A}/refresh`, 'POST', '{}'),
	b = await P.who(P.B);
P.pass(
	'bobSurvivedAliceRefresh',
	r.http === 200 && r.json?.workosUserId === P.s.alice && b.user === P.s.bob
);
```

Copy the refresh response's `Set-Cookie`:

```sh
pbpaste | ev inspect-cookie "$A" > "$P/$T.aliceRefresh.json" && cat "$P/$T.aliceRefresh.json"; pbcopy </dev/null
```

**4.5 Targeted sign-out.**

```js
var o = await P.call(`/api/auth-slots/${P.A}/sign-out`, 'POST'),
	a = await P.who(P.A),
	b = await P.who(P.B);
P.pass(
	'bobSurvivedAliceRevocation',
	o.http === 204 && a.status === 'reauthRequired' && b.user === P.s.bob
);
```

**4.6 Reauthentication.** `location.assign('<alice-reauth URL>')`, sign in as Alice, make the callback observations, then:

```sh
pbpaste | ev inspect-cookie "$A" > "$P/$T.aliceReauthentication.json" && cat "$P/$T.aliceReauthentication.json"; pbcopy </dev/null
pbpaste | ev inspect-cookie "$A" --identity > "$P/$T.aliceReauthIdentity.json" && cat "$P/$T.aliceReauthIdentity.json"; pbcopy </dev/null
```

```js
var a = await P.who(P.A),
	b = await P.who(P.B);
P.pass('aliceReauthenticationBoundIdentity', a.user === P.s.alice && b.user === P.s.bob);
```

**4.7 Removal and summary.**

```js
var d = await P.call(`/api/auth-slots/${P.A}/`, 'DELETE'),
	a = await P.who(P.A),
	b = await P.who(P.B);
P.pass(
	'bobSurvivedAliceRemoval',
	d.http === 204 && a.status === 'reauthRequired' && b.user === P.s.bob
);
var z = await P.call(`/api/auth-slots/${P.B}/`, 'DELETE');
P.pass('_bobRemoved', z.http === 204 && (await P.who(P.B)).status === 'reauthRequired');
var summary = JSON.stringify({
	bobRemoved: P.s.checks._bobRemoved,
	telemetry: P.s.telemetry,
	d1Opened: P.s.d1Opened,
	checks: Object.fromEntries(Object.entries(P.s.checks).filter(([k]) => !k.startsWith('_')))
});
if (typeof copy === 'function') copy(summary);
console.log(summary);
sessionStorage.removeItem('issue70');
```

```sh
pbpaste > "$P/$T.console.json"; cat "$P/$T.console.json"; pbcopy </dev/null
export CALLBACK_OK=true FLOW_ONE_USE_OK=true   # only after all three callback and flow/replay observations pass; otherwise leave unset
```

If the summary shows `"telemetry": false` or `"bobRemoved": false`, stop and tell the lead, then run cleanup anyway. The lead must reconcile the device's Network requests against complete labeled Worker events from the first authorization through Bob's final metadata check, including all three callbacks and replays. Edge-served static assets cannot open the Worker D1 binding; every Worker-served request must have an event. Set `AUTH_SLOT_PROOF_D1_OPENED=true` if any event reports `d1Opened: true`, or `false` only if every event reports false and coverage is complete. Without this full-run observation, leave it unset. The helper's partial aggregate cannot establish a run-wide false.

### 5. Per target: cleanup

Run this even after a failure:

```sh
ev fixtures-cleanup "$P/$T.fixtures.json" > "$P/$T.cleanup.json" && cat "$P/$T.cleanup.json"
# expect attempted 2, verifiedDeleted 2, remainingDisposableUsers 0; on failure the fixture file stays for a retry
```

Then clear site data for the staging origin and the AuthKit domain on the device: Safari > Settings > Privacy > Manage Website Data (macOS), Settings > Apps > Safari > Advanced > Website Data (iOS), or Chrome > Site settings > All sites (Android).

### 6. Per target: assemble and validate

The assembly fails closed unless telemetry, both slot removals, and the lead's full-run D1 observation are recorded. Never default an unobserved D1 result to false.

```sh
export AUTH_SLOT_PROOF_D1_OPENED=<true-or-false-from-the-lead>
jq -e '.telemetry == true and .bobRemoved == true' "$P/$T.console.json" && \
jq --arg sha "$CANDIDATE_SHA" --arg label "$DEPLOY_LABEL" --arg run "$RUN_AT" \
   --arg hw "$HW" --arg osn "$OS_NAME" --arg osv "$OS_VERSION" \
   --arg bn "$BROWSER_NAME" --arg bv "$BROWSER_VERSION" --arg ua "$UA" \
   --argjson cb "${CALLBACK_OK:-false}" --argjson fl "${FLOW_ONE_USE_OK:-false}" \
   --argjson d1 "${AUTH_SLOT_PROOF_D1_OPENED:?Full-run D1 observation required}" \
   --slurpfile ai "$P/$T.aliceInitial.json" --slurpfile bi "$P/$T.bobInitial.json" \
   --slurpfile ar "$P/$T.aliceRefresh.json" --slurpfile aa "$P/$T.aliceReauthentication.json" \
   --slurpfile ii "$P/$T.aliceIdentity.json" --slurpfile bii "$P/$T.bobIdentity.json" \
   --slurpfile ia "$P/$T.aliceReauthIdentity.json" \
   --slurpfile na "$P/$T.names.appAsset.json" --slurpfile nal "$P/$T.names.aliceSlot.json" --slurpfile nb "$P/$T.names.bobSlot.json" \
   --slurpfile con "$P/$T.console.json" --slurpfile cl "$P/$T.cleanup.json" \
   'if ($d1 | type) != "boolean" or ($con[0].d1Opened == true and $d1 != true)
     then error("Invalid or inconsistent full-run D1 observation") else . end
     | .gitCommit=$sha | .stagingDeploymentLabel=$label | .runAtUtc=$run
    | .device={hardwareModel:$hw, osName:$osn, osVersion:$osv}
    | .browser={name:$bn, version:$bv, userAgent:$ua}
    | .cookies={aliceInitial:$ai[0], bobInitial:$bi[0], aliceRefresh:$ar[0], aliceReauthentication:$aa[0]}
    | .identityCookies={aliceInitial:$ii[0], bobInitial:$bii[0], aliceReauthentication:$ia[0]}
    | .requestCookieNames={appAsset:$na[0], aliceSlot:$nal[0], bobSlot:$nb[0]}
    | .checks=({stableRegisteredCallback:$cb, opaqueOneUseFlowState:$fl} + $con[0].checks)
    | .d1Opened=$d1
    | .cleanup={aliceDeleted:($cl[0].verifiedDeleted==2), bobDeleted:($cl[0].verifiedDeleted==2),
                remainingDisposableUsers:$cl[0].remainingDisposableUsers, verifiedAtUtc:$cl[0].verifiedAtUtc}' \
   "$P/$T.template.json" > "$P/$T.json" && chmod 600 "$P/$T.json" && \
ev validate "$P/$T.json"
```

After all three targets:

```sh
ev validate-matrix "$P/native-macos-safari.json" "$P/native-ios-safari.json" "$P/native-android-chrome.json"
```

`validate` checks the schema, exact keys, forbidden keys (`password`, `state`, `nonce`, `sealedSession`, and others), the cookie policy for both cookie kinds, routing isolation, every check, and zero remaining users. `validate-matrix` also requires exactly one file per native target.

### Hand back to the lead

- The three validated `$P/native-*.json` files and the `validate-matrix` output. They hold names, byte counts, versions, and booleans only.
- Each `$P/$T.cleanup.json`, showing `remainingDisposableUsers: 0`.
- Anything that differed from this procedure, especially whether Safari showed the callback `Set-Cookie` lines. If it hides them, stop: the fallback is an intercepting proxy on the Mac, which is the lead's call.

Never hand back fixture files (they hold the password), copied `Cookie` or `Set-Cookie` values, or screenshots of Network or Storage panels. The lead records the safe facts here and on issue #70.

## Remaining external action

Run the matrix on native macOS Safari, a real iPhone or iPad, and a real Android device. A resized browser, Playwright WebKit, or device descriptor does not count. Issue #70 stays open until all three private evidence files validate and their safe facts are recorded.

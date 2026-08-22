# #83 Use one stable WorkOS callback for retained auth slots

## Summary

Route every retained-profile authorization through one registered callback URI. Carry the selected slot and flow binding in encrypted, expiring state with an HTTP-only one-use nonce marker.

## Acceptance criteria

- [ ] Add-profile and reauthentication authorization URLs use `/api/auth/callback` without a slot in the redirect URI.
- [ ] Encrypted state binds the slot, purpose, expected user, safe return path, nonce, issue time, and expiry.
- [ ] The callback rejects invalid, expired, mismatched, and replayed inputs.
- [ ] A successful callback changes only the selected slot's path-scoped session and identity cookies.
- [ ] Unit, HTTP, browser, proof, and runbook contracts cover concurrent Alice/Bob flows and reauthentication.

## Public seams

- The WorkOS authorization redirect URI and opaque `state` parameter.
- The stable callback's HTTP response, redirects, and error status.
- The retained slot cookie names, attributes, paths, and isolation in a browser cookie jar.

## TODOs

- [x] Specify the stable redirect and encrypted flow-state contract with failing unit tests.
- [x] Implement encrypted, expiring state and one-use nonce marker cookies.
- [x] Specify stable callback success and rejection behavior with failing HTTP tests.
- [x] Implement the stable callback while preserving targeted revocation and retained-cookie isolation.
- [x] Update browser and live proof contracts for concurrent flows and sanitized evidence.
- [ ] Run focused checks and the serialized full validation gate.

## Notes

- WorkOS requires an exact registered redirect URI. Slot IDs belong in sealed state, never in the redirect path.
- The flow-state secret reuses `WORKOS_COOKIE_PASSWORD`; no new deploy secret is required.
- A consumed browser nonce marker prevents ordinary callback replay. WorkOS authorization codes remain the authoritative one-use exchange in concurrent requests.
- `pnpm exec vitest run tests/unit/auth-slots.spec.ts`: 10 passed after the first red-to-green slice.
- `pnpm exec vitest run tests/unit/auth-callback-route.spec.ts tests/unit/auth-authorize-route.spec.ts tests/unit/auth-slots.spec.ts`: 16 passed.
- `pnpm check`: 0 errors and 0 warnings.
- Focused auth/proof unit suite: 20 passed.
- `pnpm exec playwright test tests/e2e/auth-slot-cookies.e2e.ts`: 2 passed, including concurrent callback marker routing.

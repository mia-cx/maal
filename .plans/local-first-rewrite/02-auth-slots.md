## Parent PRD

#55

## What to build

Implement path-scoped retained WorkOS auth slots, multi-profile switching, targeted refresh/revocation, PIN reset, and the Hosted AuthKit/custom-UI fallback from spec §4 and proof gate 1. Prove the live WorkOS flow in available desktop browsers and ship the executable native-device proof harness; the native Safari/iOS/Android release matrix is tracked separately because it requires external devices.

## Acceptance criteria

- [ ] Alice and Bob retain independent HttpOnly sessions without credentials in Dexie.
- [ ] Switching, expiry, reauthentication, sign-out, and removal affect only the selected profile.
- [ ] Eight-slot guard and cookie-size/browser tests exist; Chromium and Firefox pass against WorkOS staging with sealed cookies below 4,096 bytes.
- [ ] Hosted AuthKit is used if it passes; otherwise the documented WorkOS API fallback is implemented.
- [ ] The native Safari/iOS/Android harness and runbook are executable; completion of that external matrix is tracked by the native auth-slot proof ticket.

## Blocked by

None - can start immediately.

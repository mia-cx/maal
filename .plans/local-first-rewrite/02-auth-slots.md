## Parent PRD

#55

## What to build

Implement and prove path-scoped retained WorkOS auth slots, multi-profile switching, targeted refresh/revocation, PIN reset, and the Hosted AuthKit/custom-UI fallback from spec §4 and proof gate 1.

## Acceptance criteria

- [ ] Alice and Bob retain independent HttpOnly sessions without credentials in Dexie.
- [ ] Switching, expiry, reauthentication, sign-out, and removal affect only the selected profile.
- [ ] Eight-slot guard and cookie-size/browser tests exist.
- [ ] Hosted AuthKit is used if it passes; otherwise the documented WorkOS API fallback is implemented.

## Blocked by

None - can start immediately.

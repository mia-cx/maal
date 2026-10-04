# #58 Prove and implement retained WorkOS auth slots

## Summary

Add a path-scoped WorkOS session adapter and routes. Keep browser-readable state limited to a safe local projection. Add local and live browser proof suites.

## Acceptance criteria

- [x] Each profile has one independent secure, HTTP-only, path-scoped sealed-session cookie.
- [x] Add-profile and reauthentication callbacks cannot replace another slot.
- [x] Status, refresh, sign-out, and removal target one slot only.
- [x] Local projections enforce the eight authenticated-slot limit and never contain credentials.
- [x] Browser tests prove cookie path selection and script invisibility.
- [ ] A staging test gates Hosted AuthKit second-user behavior and real cookie size.

## TODOs

- [x] Add the shared auth-slot projection and cookie contracts.
- [x] Add the WorkOS adapter and profile-scoped HTTP routes.
- [x] Add local browser proofs and an executable WorkOS staging gate.
- [x] Run focused and repository validation, then record the live-proof status.

## Notes

- A test WorkOS environment was available from an ignored credential file outside the repo. No secret was copied or logged.
- Disposable Alice and Bob users passed direct API session isolation and exact-session revocation. Both serialized cookies measured 2,226 bytes.
- Hosted AuthKit passed the second-user gate in Chromium and Firefox. Real cookies measured 2,248 to 2,269 bytes. All disposable users were deleted.
- WebKit could not launch because the host lacks six shared libraries and sudo access. Native desktop Safari and iOS Safari remain untested, so the final acceptance item stays open.

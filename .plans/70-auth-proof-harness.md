# #70 Native retained-auth proof harness readiness

## Summary

Repair the route proof and provide a sanitized native-device evidence adapter. Keep the native matrix open until real devices run it.

## Acceptance criteria

- [x] Authenticated route requests share the browser cookie jar.
- [x] The proof measures every actual session `Set-Cookie` line and checks every required attribute.
- [x] Evidence contains browser, OS, routing, D1, session-isolation, and verified cleanup facts without secrets.
- [x] A human or trusted device runner can create and validate one private evidence file per native target.
- [x] The repository does not label Playwright emulation as native proof.

## TODOs

- [x] Add the sanitized evidence contract, cookie inspector, and validator.
- [x] Repair the deployed route proof and verify disposable staging-user cleanup.
- [x] Document the exact native run and remaining external action.
- [x] Run focused auth checks and full repository validation.

## Notes

- Native macOS Safari, iOS Safari, and Android Chrome are unavailable on this Linux host. Issue #70 must remain open.
- Focused formatting, ESLint, 14 auth/evidence unit tests, and proof-project listing pass. The local cookie-path browser check passes in the full suite.
- `pnpm validate` passes: 34 unit files and 178 tests, production build, 149,367-byte initial gzip entry under the 256,000-byte budget, and seven Playwright tests.

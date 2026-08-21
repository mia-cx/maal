# #70 Native retained-auth proof harness readiness

## Summary

Repair the route proof and provide a sanitized native-device evidence adapter. Keep the native matrix open until real devices run it.

## Acceptance criteria

- [ ] Authenticated route requests share the browser cookie jar.
- [ ] The proof measures the actual session `Set-Cookie` line and checks every required attribute.
- [ ] Evidence contains browser, OS, routing, D1, session-isolation, and verified cleanup facts without secrets.
- [ ] A human or trusted device runner can create and validate one private evidence file per native target.
- [ ] The repository does not label Playwright emulation as native proof.

## TODOs

- [x] Add the sanitized evidence contract, cookie inspector, and validator.
- [x] Repair the deployed route proof and verify disposable staging-user cleanup.
- [x] Document the exact native run and remaining external action.
- [x] Run focused auth checks and full repository validation.

## Notes

- Native macOS Safari, iOS Safari, and Android Chrome are unavailable on this Linux host. Issue #70 must remain open.
- Focused ESLint and 14 auth/evidence unit tests pass. The local cookie-path browser check passes.
- `pnpm validate` passes: 32 unit files and 166 tests, production build, 145,184-byte initial gzip entry under the 256,000-byte budget, and seven Playwright tests.

# #51 Keep Fahrenheit across fallback-locale reloads

## Summary

Prove that the Dexie-local household preference path preserves Fahrenheit when the active locale uses the
`en-US` taxonomy alias fallback. Cover the saved canonical unit, the live editor update, effective recipe
display preferences, and a fresh database reopen.

## Acceptance criteria

- [x] Saving Fahrenheit stores the canonical unit for the Celsius family.
- [x] The live household editor updates to Fahrenheit after the local command.
- [x] Effective taxonomy preferences expose Fahrenheit and its display label.
- [x] A fresh database instance reloads the same Fahrenheit selection through locale fallback.
- [x] Focused tests and checks pass.

## TODOs

- [x] Add the fallback-locale save, live-update, effective-preference, and reopen regression proof.
- [x] Apply the smallest runtime fix only if the regression proof fails.
- [x] Run focused taxonomy validation and record the results.

## Notes

- Base integration commit: `0d9d22c3439d9eb16712fb030f51048b1ccde865`.
- The approved seam is the Dexie taxonomy command plus its editor and effective-preference live queries.
- The old server-form path no longer exists. Dexie is the local authority.
- The regression passes on the rewrite without a runtime change. The existing command stores canonical
  `fahrenheit` and keeps the fallback alias reference.
- `pnpm exec vitest run tests/unit/temperature-preference-regression.spec.ts --reporter=verbose` passes 1 test.
- The focused taxonomy suite passes 11 unit tests. The existing Chromium taxonomy component proof passes.
- Focused ESLint, Prettier, and `pnpm check` pass with 0 errors and 0 warnings.
- Serialized `pnpm validate` passes 51 test files / 280 tests, the production build, the 181,394 / 256,000-byte
  gzip budget, and 19 Chromium E2E tests.

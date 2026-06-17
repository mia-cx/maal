# #22 Code review: app API route findings

## Summary

Standardize the app API auth/error contract and active-household resolution for `active-household` and taxonomy preference APIs, including the active-household stale-cookie cases called out in #16.

## Acceptance criteria

- [ ] API routes return JSON/status errors instead of redirects or implicit dependency 500s.
- [ ] Active-household selection, validation, cookie/session side effects, and missing-household classification are centralized.
- [ ] Taxonomy preferences distinguishes users with no households from invalid or absent active-household state.
- [ ] Malformed active-household JSON is diagnosed server-side while keeping the client response generic.
- [ ] Focused tests cover the shared context helper and affected API route behavior.

## TODOs

- [x] Extend shared household/app context helpers to classify household resolution and dependency failures.
- [x] Move active-household and taxonomy preference APIs onto the shared API contract.
- [x] Add focused tests for helper and route behaviors.
- [x] Run focused and repo-level validation.

## Notes

- Issue #22 covers API auth/error consistency, household resolution duplication, dependency failure mapping, and malformed JSON context.
- Issue #16 active-household scope covers stale/inaccessible household IDs and API routes returning browser redirects/defaults instead of API errors.
- `pnpm test:unit -- --run src/lib/server/http/app-context.test.ts` passed; the script invocation ran the current unit suite (46 files, 166 tests).
- `pnpm vitest run src/lib/server/http/app-context.test.ts src/lib/server/http/request.test.ts` passed (2 files, 12 tests).
- `pnpm vitest run 'src/routes/(app)/api/active-household/server.test.ts' 'src/routes/(app)/api/taxonomy/preferences/server.test.ts'` passed (2 files, 9 tests).
- `pnpm lint` is blocked by pre-existing Prettier drift across 403 files; changed files were formatted and passed targeted `prettier --check` plus `eslint`.
- Final validation passed: `pnpm vitest run src/lib/server/http/app-context.test.ts src/lib/server/http/request.test.ts 'src/routes/(app)/api/active-household/server.test.ts' 'src/routes/(app)/api/taxonomy/preferences/server.test.ts'`, `pnpm check`, and `pnpm architecture:check`.

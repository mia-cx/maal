# #9 Code review: HTTP module findings

## Summary
Address the HTTP module review findings by tightening JSON object parsing, splitting billing-gated app context from base app context, making known error mapping explicit and less brittle, and hardening HTTP helper tests.

## Acceptance criteria
- [x] JSON request helpers reject arrays and non-plain object bodies.
- [x] Routes can require authenticated household context without implicitly enforcing billing access.
- [x] Billing-gated routes opt in to entitlement checks through a dedicated helper.
- [x] Known domain error translation uses typed identifiers or explicit key lookups and remains integrated with routes.
- [ ] HTTP helper tests clear mocks and assert billing calls precisely without broad fixture casts where practical.
- [ ] Validation commands from the issue pass or residual risks are documented.

## TODOs
- [x] Tighten `readJsonObject` plain-object validation and add request regression tests.
- [x] Split app context into base and billing-gated helpers, then update routes to opt in intentionally.
- [x] Replace brittle known-error mapping with typed domain error codes and update route/service call sites.
- [ ] Harden app-context tests by clearing mocks, asserting call counts, and using shaped test doubles.
- [ ] Run final HTTP/module validation and file the PR.

## Notes
- Issue review source: `/tmp/code-review/lib-server-http/CODE_REVIEW.md` on `refactor/deep-modularization`.
- Worktree created at `.worktrees/9-code-review-http-findings` from `origin/main`; existing root changes left untouched per user instruction.
- `pnpm test:unit -- --run src/lib/server/http/request.test.ts` passed (Vitest ran the configured suite: 38 files, 141 tests).
- `pnpm test:unit -- --run src/lib/server/http/app-context.test.ts` passed (Vitest ran the configured suite: 38 files, 142 tests).
- `pnpm test:unit -- --run src/lib/server/http/domain-errors.test.ts src/lib/server/services/meal-route-input.test.ts src/lib/server/services/meal-check-in-input.test.ts` passed (Vitest ran the configured suite: 39 files, 145 tests).

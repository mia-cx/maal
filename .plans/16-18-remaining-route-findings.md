# #16/#18 Remaining app and household route findings

## Summary
Close the code-review refactor remainder for app routes and household routes, leaving #24 localization for later. Prior PRs closed most duplicated findings; this PR focuses on the still-visible code-state gaps: household invite/onboarding robustness, stale household resolution fallbacks, subscribe pricing pagination, duplicated taxonomy preference loading, and small app-shell cleanup.

## Acceptance criteria
- [ ] Household invite revoke/delete/role actions return structured `fail(...)` responses on parsing/DB/auth failures.
- [ ] Household onboarding separates household creation from best-effort trial setup and does not report trial failures as creation failures.
- [ ] Household route UI handles invite clipboard failures and shared household validation constants are reused by server and UI.
- [ ] App layout/subscribe loaders do not hide household-list failures as empty household lists.
- [ ] Subscribe pricing loads all active product prices or uses a shared paginated billing helper.
- [ ] Locale/taxonomy preference loading is centralized for app route/service callers that currently duplicate household locale lookup.
- [ ] App shell active nav mapping is flattened.
- [ ] Validation covers changed household/app route behavior.

## TODOs
- [ ] Harden household invite actions and onboarding trial handling.
- [ ] Reuse household validation constants and handle invite clipboard failures in the household UI.
- [ ] Stop masking household-list failures and paginate subscribe pricing.
- [ ] Centralize household taxonomy preference loading across menu/plan/recipe service callers.
- [ ] Flatten app-shell active nav mapping and add/update focused tests.
- [ ] Run final repo validation and file a PR closing #16 and #18.

## Notes
- #24 localization is intentionally out of scope until code-review refactor is finished.
- Svelte MCP tools are unavailable in this session (`mcp search svelte` returned no tools), so Svelte autofixer cannot be run.

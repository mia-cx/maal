# #45 Investigate load speed regressions on main

## Summary
Investigate current load speed on `main` for `/plan`, `/menu`, and settings/household surfaces, separate production-impacting regressions from dev noise, then either apply a small safe fix or file follow-up implementation issues with evidence.

## Acceptance criteria
- [ ] Establish a baseline with reproducible commands or browser steps.
- [ ] Identify the biggest regression source(s) with evidence.
- [ ] File follow-up implementation issues if the fix needs multiple slices, or fix directly if it is small and safe.
- [ ] Add or extend lightweight smoke/perf checks where practical.
- [ ] `pnpm check` passes after any code changes.

## TODOs
- [x] Map existing route loaders, smoke fixtures, and test/deploy commands relevant to `/plan`, `/menu`, and household/settings.
- [ ] Build a reproducible production-style load timing harness and capture cold/warm baselines for target routes.
- [ ] Inspect bundle/server/client evidence to isolate the largest regression source and decide whether to fix directly or file follow-ups.
- [ ] Add or extend lightweight smoke/perf coverage for the regression source.
- [ ] Run focused validation plus `pnpm check`, then prepare PR notes with evidence.

## Notes
- Issue body calls out possible overlap with Svelte `effect_update_depth_exceeded`, but asks to track load speed separately.
- Mapped loaders: `/plan` loads household profile, taxonomy preferences, members, and `loadMealPlanMeals`; `/menu` checks billing access then loads active and archived recipes with `loadMenuRecipes`; `/household` calls WorkOS organization/members plus household/taxonomy data; `/settings` routes are static shells.
- Existing commands: `pnpm build`, `pnpm preview`, `pnpm check`, `pnpm test:e2e`. Playwright config builds and previews on port 4173.

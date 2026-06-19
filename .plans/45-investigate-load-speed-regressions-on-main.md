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
- [x] Build a reproducible production-style load timing harness and capture cold/warm baselines for target routes.
- [x] Inspect bundle/server/client evidence to isolate the largest regression source and decide whether to fix directly or file follow-ups.
- [x] Add or extend lightweight smoke/perf coverage for the regression source.
- [ ] Run focused validation plus `pnpm check`, then prepare PR notes with evidence.

## Notes

- Issue body calls out possible overlap with Svelte `effect_update_depth_exceeded`, but asks to track load speed separately.
- Mapped loaders: `/plan` loads household profile, taxonomy preferences, members, and `loadMealPlanMeals`; `/menu` checks billing access then loads active and archived recipes with `loadMenuRecipes`; `/household` calls WorkOS organization/members plus household/taxonomy data; `/settings` routes are static shells.
- Existing commands: `pnpm build`, `pnpm preview`, `pnpm check`, `pnpm test:e2e`. Playwright config builds and previews on port 4173.
- Added `pnpm perf:load`, backed by `scripts/perf/load-smoke.mjs`, to run Playwright against a production `pnpm preview` server with smoke auth.
- Updated `scripts/smoke/seed.sql` to match the current schema and seed local D1 with 80 recipes and 730 meals for repeatable smoke/perf measurements.
- Baseline command: `MAAL_SMOKE_AUTH_ENABLED=true pnpm build`, `MAAL_SMOKE_AUTH_ENABLED=true pnpm preview`, then `MAAL_PERF_ITERATIONS=5 pnpm perf:load`.
- Baseline result on local Wrangler preview: `/plan` warm p50 119ms; `/menu` warm p50 113ms; `/household` warm p50 97ms; `/settings` redirects to `/plan?settings=account` with warm p50 156ms. Cold max outliers ~650–750ms appear dominated by first asset/service-worker work in local Wrangler rather than route server time.
- Biggest server-side source found while measuring `/menu`: `loadMenuRecipes` collected every linked meal id for the visible recipes and then queried meals/check-ins with huge `IN (...)` lists. With the smoke fixture this exceeded D1/SQLite variable limits and 500ed; on real data it scales with meal history rather than page size. Fixed directly by joining through `household_meal_user_recipes` and `household_meals` instead of issuing unbounded ID-list queries.
- Lightweight coverage added: `pnpm perf:load` exercises `/plan`, `/menu`, `/household`, and the settings entry redirect against a seeded smoke dataset; the command fails on non-200 responses or browser console/page errors.

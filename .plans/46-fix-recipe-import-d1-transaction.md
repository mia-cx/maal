# #46 Fix recipe import 500 on POST /menu/recipes D1 transaction begin

## Summary
Recipe creation/import currently wraps the initial recipe write and sidecar writes in a Drizzle D1 transaction. D1/local dev fails before any write with `Failed query: begin`, so `POST /menu/recipes` returns 500. This work is based on the issue #44 worktree as requested.

## Acceptance criteria
- [ ] Reproduce the 500 with a local recipe import/create request.
- [ ] Identify why `SQLiteD1Session.transaction` fails at `begin`.
- [ ] Restore recipe import/create behavior for D1/local dev and deployed Cloudflare runtime.
- [ ] Add/extend a regression test for `POST /menu/recipes` covering the failing path.
- [ ] `pnpm check` passes.

## TODOs
- [x] Add a focused regression test and refactor `POST /menu/recipes` create writes out of the failing D1 transaction path.
- [x] Refactor `POST /plan/meals` creation out of the same failing D1 transaction path after import succeeded and scheduling exposed the next `begin` failure.
- [x] Refactor `PUT /plan/meals` updates out of the D1 transaction path and restore source amount/unit text on the meal sheet when taxonomy base amounts are unavailable.
- [x] Remove remaining Drizzle `.transaction(...)` calls across app routes and server services because D1 rejects SQL `BEGIN`/`SAVEPOINT` in this runtime.
- [x] Add a D1 batch helper that uses Drizzle-generated SQL for D1-native batched transactions where statements can be prepared up front.
- [x] Run focused route tests and type checks, then record final validation.

## Notes
- Issue #46 reports Drizzle/D1 failing on `begin` in `src/routes/(app)/menu/recipes/+server.ts` line ~848.
- Existing branch/worktree `issue/46-fix-recipe-import-d1-transaction` existed at `main`; fast-forwarded it to `issue/44-fix-svelte-effect-update-depth-loops` (`d8378e55`) so this work is based on the #44 worktree.
- Reproduced the failing path with `pnpm vitest run 'src/routes/(app)/menu/recipes/server.test.ts'`: fake D1 `transaction` threw `Failed query: begin` from POST line 848 before writes completed.
- Root cause: the POST create path used Drizzle's interactive `db.transaction`, which issues `BEGIN`; Cloudflare D1 rejects that path in local/dev worker execution, so the request fails before inserts.
- Fix: keep the same write order but issue direct D1-compatible writes: insert the recipe row, replace ingredients, replace instructions, then save sidecars.
- Focused validation: `pnpm vitest run 'src/routes/(app)/menu/recipes/server.test.ts'` — passed.
- Final validation: `pnpm vitest run 'src/routes/(app)/menu/recipes/server.test.ts' && pnpm check` — passed; `svelte-check found 0 errors and 0 warnings`.
- Follow-up user repro after import succeeded: `POST /plan/meals` failed at `createHouseholdMeal` line ~160 with the same Drizzle/D1 `Failed query: begin` error.
- Added `src/lib/server/services/meal-plan.test.ts` to reproduce the scheduling `begin` failure and moved meal creation to ordered D1-compatible writes: insert meal first, then recipe link/sidecars or custom meal sidecars.
- Focused validation: `pnpm vitest run src/lib/server/services/meal-plan.test.ts 'src/routes/(app)/menu/recipes/server.test.ts'` — passed.
- Follow-up user repro: editing/saving a planned meal hit `PUT /plan/meals` 500 from the same `Failed query: begin` path in `updateHouseholdMeal`.
- Fix: moved `updateHouseholdMeal` to ordered D1-compatible writes and added regression coverage proving update does not call `db.transaction`.
- Screenshot showed ingredient source amounts/units hidden in the meal sheet because display only used taxonomy `baseQuantity/baseUnitId`; imported ingredients currently have source amount text but not taxonomy base amounts. Display now preserves original source text when canonical amounts are unavailable, e.g. `2 el gerookte-paprikapoeder`.
- Final validation: `pnpm vitest run src/lib/server/services/meal-plan.test.ts src/lib/taxonomy/display.test.ts 'src/routes/(app)/menu/recipes/server.test.ts' && pnpm check` — passed; `svelte-check found 0 errors and 0 warnings`.
- Follow-up user repro: household settings failed at `updateHouseholdSettingsFromForm` with D1 explicitly rejecting SQL `BEGIN` and instructing use of D1 JavaScript transaction APIs instead of SQL statements.
- Swept all remaining Drizzle `.transaction(...)` calls from `src`: recipe restore/delete/edit routes, saved recipe service helpers, household settings/appliance/delete commands, meal check-ins, instruction event insertion, and taxonomy display override helpers now issue ordered D1-compatible writes directly.
- Verification sweep: `rg -n "\\.transaction\\(" src -g '*.ts'` returns no production transaction calls; remaining `transaction` text is only regression tests, comments, and type aliases.
- Validation after sweep: `pnpm vitest run src/lib/server/services/meal-plan.test.ts src/lib/taxonomy/display.test.ts 'src/routes/(app)/menu/recipes/server.test.ts'` — passed; `pnpm check` — passed.
- Added `src/lib/server/db/d1-batch.ts`: converts Drizzle query builders via `.toSQL()` into `D1Database.prepare(sql).bind(...params)` statements and executes them with `database.batch(...)`.
- Applied D1-native batches where statements are known up front: appliance settings upserts, bulk/single recipe restore, soft delete, and permanent-delete write phases.
- Kept ordered Drizzle writes where flows need reads/results between writes or rely on reusable sidecar helpers; those still avoid Drizzle `.transaction(...)`.
- Validation after D1 batch helper: `rg -n "d1Batch|requireD1Database|\\.transaction\\(" src -g '*.ts'` shows D1 batch usage and no `.transaction(...)`; `pnpm vitest run src/lib/server/services/meal-plan.test.ts src/lib/taxonomy/display.test.ts 'src/routes/(app)/menu/recipes/server.test.ts'` — passed; `pnpm check` — passed.

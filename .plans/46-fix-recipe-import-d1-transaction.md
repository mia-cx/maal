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
- [ ] Run focused route tests and type checks, then record final validation.

## Notes
- Issue #46 reports Drizzle/D1 failing on `begin` in `src/routes/(app)/menu/recipes/+server.ts` line ~848.
- Existing branch/worktree `issue/46-fix-recipe-import-d1-transaction` existed at `main`; fast-forwarded it to `issue/44-fix-svelte-effect-update-depth-loops` (`d8378e55`) so this work is based on the #44 worktree.
- Reproduced the failing path with `pnpm vitest run 'src/routes/(app)/menu/recipes/server.test.ts'`: fake D1 `transaction` threw `Failed query: begin` from POST line 848 before writes completed.
- Root cause: the POST create path used Drizzle's interactive `db.transaction`, which issues `BEGIN`; Cloudflare D1 rejects that path in local/dev worker execution, so the request fails before inserts.
- Fix: keep the same write order but issue direct D1-compatible writes: insert the recipe row, replace ingredients, replace instructions, then save sidecars.
- Focused validation: `pnpm vitest run 'src/routes/(app)/menu/recipes/server.test.ts'` — passed.

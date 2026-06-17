# #13 + #19 Stabilize recipe menu load/save/import flows

## Summary
Address the menu component and route review findings as one coherent hardening pass: make client hydration/save/selection behavior reliable, tighten recipe payload/import handling, and wrap menu recipe mutations in safer transaction/lifecycle helpers.

## Acceptance criteria
- [ ] Menu dashboard reconciles server prop updates even when recipe IDs are unchanged.
- [ ] Recipe sheet save/create/update/import flows await async work, surface failures, and only close after success.
- [ ] Bulk selection/actions operate on the currently displayed recipe source, including server search results.
- [ ] Instruction reorder controls share one direction contract across keyboard and buttons.
- [ ] Import-from-URL UI has one typed callback contract.
- [ ] Menu formatting/date/fixture hygiene findings are fixed.
- [ ] Menu recipe route create/update/delete/permanent-delete workflows run transactionally where multi-step writes occur.
- [ ] Recipe payloads receive shared runtime validation before DB mapping/writes.
- [ ] Import URL fetching centralizes max-length, scheme, host, timeout, and redirect validation to reduce SSRF risk.
- [ ] Menu load/household failure paths do not retain stale data silently.

## TODOs
- [x] Fix client menu state lifecycle: hydration signatures, async sheet saves, displayed-source selection, import callback typing, reorder direction, formatting helpers, and fixtures.
- [x] Add shared route validation/URL safety helpers with focused tests for malformed recipes and unsafe import URLs.
- [ ] Transactionalize create/update lifecycle writes and align post-write reload behavior.
- [ ] Transactionalize archive/restore/permanent delete paths and only delete meals after recipe links are removed and no links remain.
- [ ] Harden menu load household/promise failure handling and add visible client error behavior where needed.
- [ ] Run focused menu validation and final repo checks; update PR notes with results.

## Notes
- 2026-06-17: Issues #13 and #19 are open. Parent worktree has unrelated local changes; this worktree was created from `origin/main` to leave them untouched.
- 2026-06-17: Svelte MCP server requested by AGENTS.md is not available in this Pi session (`mcp` only lists maal), so Svelte docs/autofixer cannot be used here.
- 2026-06-17: Client lifecycle TODO complete. `pnpm check` passes after making menu store updates awaitable, save failures visible, selection display-source aware, URL import prop typed by one callback presence flag, instruction arrow semantics consistent, date/minute/title formatting stricter, and fixture ingredient counts derived at export.
- 2026-06-17: Validation/URL safety TODO complete. Added shared `parseRecipeMenuItemPayload`, wired create/update route bodies to reject malformed nested recipes, moved import URL max-length enforcement into `fetchRecipeImportPage`, and covered both with unit tests. `pnpm test:unit -- --run src/lib/menu/recipe-payload.test.ts src/lib/server/services/recipe-import-fetch.test.ts` exited 0 (Vitest ran the configured suite because of script arg handling); `pnpm check` passes.

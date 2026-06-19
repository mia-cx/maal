# #51 Temperature unit preference resets to Celsius

## Summary

The original Fahrenheit reset appears fixed, but the household settings page still submits save forms with native browser posts. Saving household settings, appliances, or alias/unit overrides should use SvelteKit enhanced form submissions so the page does not perform a full document reload.

## Acceptance criteria

- [ ] Setting preferred temperature unit to Fahrenheit persists across reloads.
- [ ] Effective taxonomy preferences use Fahrenheit for temperature display after the setting is saved.
- [ ] Locale fallback aliases do not reset Fahrenheit back to Celsius.
- [ ] Household settings save buttons submit without a full page reload.
- [ ] All new tests pass.
- [ ] Existing tests still pass.

## TODOs

- [x] Add regression coverage that household save forms are progressively enhanced instead of native page posts.
- [x] Enhance the household settings save forms while preserving existing optimistic invite/member behavior.
- [x] Run focused validation and final repo checks.

## Notes

- 2026-06-19: Confirmed issue #51 is open. User reports Fahrenheit reset is no longer reproducible but any save button reloads the page, which is poor UX.
- Svelte MCP server was unavailable in this runtime (`Server "svelte" not found`), so implementation follows existing SvelteKit `enhance` usage in the route.
- 2026-06-19: Added `page-source.test.ts` regression coverage. Initial RED failed because `updateSettings` and `updateAppliances` forms lacked `use:enhance`.
- 2026-06-19: Added `use:enhance` to non-redirecting household forms: household settings, appliances, alias/unit overrides, member role, invite role, and create invite. Existing delete/revoke invite forms kept their custom enhance handlers.
- Validation: `pnpm vitest run 'src/routes/(app)/household/page-source.test.ts'` — pass.
- Validation: `pnpm check` — pass.
- Validation: `pnpm prettier --check .plans/51-temperature-unit-preference.md 'src/routes/(app)/household/+page.svelte' 'src/routes/(app)/household/page-source.test.ts'` — pass.
- Validation: `pnpm eslint 'src/routes/(app)/household/+page.svelte' 'src/routes/(app)/household/page-source.test.ts'` — pass.
- Validation: `pnpm test:unit -- --run` — pass, 71 files / 262 tests.
- Validation note: full `pnpm lint` still fails on pre-existing repository-wide Prettier warnings across generated/ui files and older plan files; changed files pass focused Prettier and ESLint.

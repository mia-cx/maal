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
- [ ] Add regression coverage that household save forms are progressively enhanced instead of native page posts.
- [ ] Enhance the household settings save forms while preserving existing optimistic invite/member behavior.
- [ ] Run focused validation and final repo checks.

## Notes
- 2026-06-19: Confirmed issue #51 is open. User reports Fahrenheit reset is no longer reproducible but any save button reloads the page, which is poor UX.
- Svelte MCP server was unavailable in this runtime (`Server "svelte" not found`), so implementation follows existing SvelteKit `enhance` usage in the route.

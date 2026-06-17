# #16/#18/#19/#20 Cross-app deferred data / stale state cleanup

## Summary
Clean up the remaining cross-app deferred/stale state hazards mechanically: keep already-synchronous menu/plan route data stable, and make the household page's deferred refresh error-aware and stale-result guarded.

## Acceptance criteria
- [ ] Household deferred `freshView` failures are caught and do not produce unhandled rejections.
- [ ] Late household refresh resolutions cannot overwrite newer route data.
- [ ] Fresh household view replacement does not retain stale top-level fields.
- [ ] Menu/plan route caches store concrete resolved data without promise-based stale writes.
- [ ] Focused Svelte/type validation passes.

## TODOs
- [x] Guard household `freshView` hydration with a version token and rejection handling.
- [x] Replace household view state cleanly and clone mutable override rows when applying fresh data.
- [ ] Validate menu/plan synchronous route-data cache behavior and run focused checks.

## Notes
- Issues #19 and #20 are closed, but this PR intentionally covers the cross-cutting deferred/stale subset called out by the user.
- Svelte MCP server was unavailable in this session (`mcp` only listed `maal`), so local code and validation are the available Svelte checks.
- `pnpm prettier --check 'src/routes/(app)/household/+page.svelte'` passed.
- `pnpm check` passed after guarding `freshView` resolution/rejection.
- `pnpm prettier --check 'src/routes/(app)/household/+page.svelte'` passed after cloning override rows.
- `pnpm check` passed after cloning override rows.

# #44 Fix Svelte effect update-depth loops in route cache effects

## Summary
Fix route-cache `$effect` blocks that assign `$state` and then read the same state for cache writes, which can trigger Svelte `effect_update_depth_exceeded` during hydration/navigation.

## Acceptance criteria
- [ ] Audit `$effect` usage for read-after-write patterns that can self-invalidate.
- [ ] Fix `/plan` hydration without `effect_update_depth_exceeded`.
- [ ] Fix analogous `/menu` route-cache effect.
- [ ] Check other route/component `$effect` blocks for the same class of bug and fix confirmed cases.
- [ ] Add lightweight regression test where practical, or document why browser-only runtime coverage is the right verification.
- [ ] `pnpm check` passes.

## TODOs
- [x] Audit existing `$effect` blocks and identify confirmed self-invalidating read-after-write cases.
- [ ] Fix `/plan` and `/menu` route-cache effects to cache non-reactive locals.
- [ ] Add or document regression coverage for the route-cache effect class.
- [ ] Run final validation and update this plan with results.

## Notes
- Svelte MCP server is not configured in this Pi session (`mcp({ server: "svelte" })` returned not found), so documentation lookup was unavailable.
- Initial issue/code read confirmed the reported `/plan` and `/menu` effects read state variables in the cache payload immediately after assigning them.
- Audited all `rg '$effect' src` matches. Confirmed route-cache self-invalidating read-after-write cases only in `src/routes/(app)/plan/+page.svelte` and `src/routes/(app)/menu/+page.svelte`; other hits either read before write as guards, write in async callbacks/event handlers, or do not read the same state after assignment in the same effect.

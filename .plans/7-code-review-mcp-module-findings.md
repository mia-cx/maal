# #7 Code review: MCP module findings

## Summary
Address MCP module code-review findings by tightening input validation, permission checks, registry behavior, cleanup, result serialization, pagination, delete semantics, and tests.

## Acceptance criteria
- [ ] MCP write tools enforce both key scope and household role permissions where required.
- [ ] MCP boundary helpers reject malformed scalar/object/date/source/batch inputs with `invalid_input` instead of silently normalizing or failing generically.
- [ ] Registry, protocol, result serialization, pagination, and delete semantics match the review findings.
- [ ] MCP tests cover the fixed behavior and validation commands pass.

## TODOs
- [x] Tighten scalar, required-id, meal source, date range, and batch meal input validation.
- [x] Enforce check-in role permissions and update planning tools to use strict required IDs.
- [ ] Harden registry, protocol cleanup, result serialization, recipe delete semantics, and pagination behavior.
- [ ] Add or update MCP unit tests for the fixed review findings.
- [ ] Run final validation and file the PR.

## Notes
- Created worktree from `origin/main` because the repository root had unrelated uncommitted changes.
- Issue body validation target: `pnpm check`, `pnpm test:unit -- --run src/lib/server/mcp`, `pnpm architecture:check`.

- Tightened scalar helpers, meal source exclusivity, date range validation, and batch meal validation.
- Validation: `pnpm test:unit -- --run src/lib/server/mcp/meal-input.test.ts src/lib/server/mcp/plan-range.test.ts` passed.
- Check-ins now resolve with `check_ins:write` scope plus `meals:write` household role; meal/recipe IDs use `requireNonEmptyText`.
- Validation: `pnpm test:unit -- --run src/lib/server/mcp/context.test.ts` passed; `pnpm check` blocked because generated `worker-configuration.d.ts` is absent in this worktree.

# #7 Code review: MCP module findings

## Summary
Address MCP module code-review findings by tightening input validation, permission checks, registry behavior, cleanup, result serialization, pagination, delete semantics, and tests.

## Acceptance criteria
- [x] MCP write tools enforce both key scope and household role permissions where required.
- [x] MCP boundary helpers reject malformed scalar/object/date/source/batch inputs with `invalid_input` instead of silently normalizing or failing generically.
- [x] Registry, protocol, result serialization, pagination, and delete semantics match the review findings.
- [x] MCP tests cover the fixed behavior and validation commands pass.

## TODOs
- [x] Tighten scalar, required-id, meal source, date range, and batch meal input validation.
- [x] Enforce check-in role permissions and update planning tools to use strict required IDs.
- [x] Harden registry, protocol cleanup, result serialization, recipe delete semantics, and pagination behavior.
- [x] Add or update MCP unit tests for the fixed review findings.
- [x] Run final validation and file the PR.

## Notes
- Created worktree from `origin/main` because the repository root had unrelated uncommitted changes.
- Issue body validation target: `pnpm check`, `pnpm test:unit -- --run src/lib/server/mcp`, `pnpm architecture:check`.

- Tightened scalar helpers, meal source exclusivity, date range validation, and batch meal validation.
- Validation: `pnpm test:unit -- --run src/lib/server/mcp/meal-input.test.ts src/lib/server/mcp/plan-range.test.ts` passed.
- Check-ins now resolve with `check_ins:write` scope plus `meals:write` household role; meal/recipe IDs use `requireNonEmptyText`.
- Validation: `pnpm test:unit -- --run src/lib/server/mcp/context.test.ts` passed; `pnpm check` blocked because generated `worker-configuration.d.ts` is absent in this worktree.
- Registry now rejects duplicate tools and non-object decoded args; protocol closes on connect failures; result serialization has safe error fallback; recipe deletion checks affected rows; recipe pagination fetches one extra row.
- Validation: `pnpm check` passed after generating `worker-configuration.d.ts`.
- Added scalar and registry tests; updated result, date range, meal input, and context tests for stricter behavior.
- Validation: `pnpm test:unit -- --run src/lib/server/mcp` passed.
- Final validation passed: `pnpm check`; `pnpm test:unit -- --run src/lib/server/mcp`; `pnpm architecture:check`.

# Deep modularization migration notes

Use these notes when rebasing feature work across the refactor.

## Server routes

- Prefer `requireAppContext` for authenticated app endpoints.
- Prefer `readJsonObject` for JSON request bodies.
- Prefer domain public APIs from `src/lib/server/domains/*` before importing service internals.

## MCP

- Import route-level protocol helpers from `src/lib/server/mcp`.
- Add tool behavior in the relevant `*-tools.ts`/`*-adapter.ts` area.
- Update `tools.test.ts` only for intentional public contract changes.

## Client features

- Use `src/lib/menu/menu-client.ts` for menu HTTP calls.
- Use dashboard planning client helpers for schedule meal calls.
- Import feature contracts from public barrels instead of deep component paths.

## Settings UI

- Keep section-specific display in `src/lib/components/settings/*`.
- Keep field/state shaping in `src/lib/settings/*-model.ts` modules.
- Keep route-specific mutation transport in `src/lib/settings/*-client.ts` modules.

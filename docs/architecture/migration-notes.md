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

## Household server modules

- Use household load/action context helpers before adding route-local session or household checks.
- Put cascade deletes, invite commands, member commands, and settings commands in the household server modules.
- Keep the household page server as an adapter that composes those helpers.

## Taxonomy

- Use `src/lib/server/taxonomy/options.ts` for option loading.
- Use `src/lib/server/taxonomy/display-overrides.ts` for display override queries and commands.
- Keep route loaders from duplicating taxonomy joins or display override mapping.

## Billing

- Import checkout, portal, status, webhook, and pricing helpers through `src/lib/server/domains/billing` when crossing a route/domain boundary.
- Keep Stripe event parsing and persistence side effects in billing server modules.
- Keep subscription route loaders focused on redirect/page-data behavior.

## Meal sidecars

- Use meal sidecar projection and writer helpers for ingredient/instruction copies.
- Do not duplicate recipe-to-meal copy rules in routes or MCP tools.
- Preserve ad-hoc meal overrides by keeping sidecar writes behind planning services.

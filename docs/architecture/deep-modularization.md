# Deep modularization refactor

## Goal

Move Maal from route-centered modules to domain-centered modules that can later become independently owned frontend/API surfaces.

## Domains

- **App shell/session**: authenticated layout, household selection, current session projection, global navigation.
- **Planning**: meal plan queries and commands, schedule state, check-ins, drag/drop, range loading, schedule views.
- **Menu/recipes**: saved recipe CRUD, import, editor, recipe cards, ranking, recipe-to-meal projections.
- **Household**: profile, members, invites, appliances, locale/timezone/week start, household preferences.
- **Taxonomy/preferences**: units, foods, aliases, effective display preferences, overrides.
- **Settings**: account, security, MFA, MCP keys, notifications, billing settings category shell.
- **Billing**: entitlements, subscription status, checkout, portal, webhooks, trial state.
- **MCP/API**: key verification, tool registry, schema decoding, tool handlers, result formatting.
- **Shared kernel**: request parsing, pagination, date ranges, constants, tiny pure utilities.
- **Design system**: generated/generic UI primitives only.

## Boundary rules

- SvelteKit routes are transport adapters: parse transport input, build request context, call a domain API, map errors to HTTP.
- Domain internals must not import from `src/routes`.
- Product domains should import other domains only through documented public APIs.
- Design-system primitives must not import product-domain modules.
- Server-only behavior stays behind server-only module surfaces.
- Client stores are feature internals unless exported through a domain client API.

## First risk centers

- Recipe-to-meal sidecar copying and meal ingredient/instruction replacement.
- `src/routes/(app)/mcp/+server.ts` protocol/tool/service mixing.
- `src/routes/(app)/household/+page.server.ts` load/action orchestration.
- `src/routes/(app)/household/+page.svelte` and `src/lib/components/user-settings-dialog.svelte` monoliths.
- `src/lib/components/dashboard/schedule-dashboard.svelte` schedule orchestration.

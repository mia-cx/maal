# Client store contracts

Client stores are UI state caches, not domain service boundaries.

## Use a store when

- The data is already loaded for the current screen and the component needs reactive reads.
- The interaction is local UI state: selected meal, selected recipe, active settings category, sidebar state, or scroll state.
- The store exposes an optimistic update helper that already owns rollback behavior.

## Use a domain/client command when

- The interaction crosses the network.
- The caller needs to create, update, archive, restore, or delete domain data.
- The same behavior is needed by more than one feature surface.
- The behavior has business rules, authorization expectations, or response-shape compatibility concerns.

## Current public contracts

- `src/lib/stores/index.ts` exposes store contracts for schedule meals, menu recipes, and app UI state.
- Planning mutations go through dashboard/planning client command modules before stores reconcile optimistic state.
- Menu recipe mutations go through `src/lib/menu/menu-client.ts`; the menu store owns local cache reconciliation.

Product components may import public stores for reactive display. New code should not construct route URLs directly when a feature client command exists.

# Design-system boundaries

`src/lib/components/ui/*` contains design-system primitives. Treat generated or vendor-like shadcn-svelte wrappers as infrastructure, not product feature modules.

## Rules

- Product components may import design-system primitives.
- Design-system primitives must not import product domains, stores, route modules, or server modules.
- Product-specific behavior belongs in a domain/feature component, not in `components/ui`.
- Semantic duplication scans may ignore unmodified generated primitive wrappers; hand-authored product behavior inside a primitive is not exempt.
- New product features should import primitives through either their existing primitive module path or `src/lib/components/ui/index.ts` when a stable public primitive export is needed.

## Extraction triggers

Move code out of a primitive when it contains:

- route URLs or fetch calls,
- domain words such as meal, recipe, household, billing, MCP, taxonomy, invite, or subscription,
- store imports,
- authorization/session assumptions,
- product-specific labels, empty states, or action copy.

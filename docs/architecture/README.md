# Architecture notes

Start here when adding or refactoring product code:

- `deep-modularization.md` — target domain boundaries and current public surfaces.
- `route-adapters.md` — what SvelteKit route files may own.
- `client-store-contracts.md` — when to use stores versus client/domain commands.
- `design-system-boundaries.md` — design-system primitive rules.
- `component-size-guidelines.md` — extraction triggers for large components.
- `duplication-policy.md` — semantic duplication threshold and exceptions.
- `mcp-compatibility.md` — MCP tool contract/versioning rules.
- `accessibility-smoke-checks.md` — smoke checklist for split UI components.
- `review-checks.md` — commands to run before review.
- `migration-notes.md` — import and ownership changes to use while rebasing feature work.
- `implementation-map.md` — current locations for shared helpers, domains, clients, and public UI surfaces.

Decision records live in `docs/adr/`.

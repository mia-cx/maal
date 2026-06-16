# Review checks

Run these before review:

```bash
pnpm check
pnpm test:unit -- --run
pnpm architecture:check
```

Run `pnpm test:e2e` for final validation before merging a broad route/component refactor.

`pnpm architecture:check` runs:

- `pnpm boundaries:check` — catches forbidden imports across route/server/design-system/menu public boundaries.
- `pnpm duplicates:scan` — flags repeated semantic blocks outside generated/import-only noise.

Boundary failures should usually be fixed by moving behavior behind a public domain API, feature client adapter, or feature barrel. Duplicate scan failures should usually become shared kernel utilities, domain services, or documented exceptions.

# Performance budgets

Initial enforceable values live in `performance-budgets.json`:

- Initial SPA entry: at most 250 KiB gzip; editor and schedule routes must lazy-load.
- Initial shell render: at most 1,000 ms in the standard desktop fixture.
- Interaction response: at most 100 ms, with no task longer than 50 ms.
- Cumulative layout shift: at most 0.1.
- Menu fixture: 10,000 local recipes.
- Push: at most 100 mutations and 512 KiB per request.

Architectural budgets are mandatory even where automation arrives in a later slice: no domain query or schema
decode during rendering, indexed Dexie date-range queries, animation-frame-bounded schedule writes, bounded
pull transactions, and indexed D1 list queries.

`pnpm perf:budget` enforces the bundle budget from a production Cloudflare build. Render, interaction, and
large-fixture budgets become browser benchmarks when their corresponding vertical slices introduce real UI;
until then the numeric limits are committed here so later work cannot silently redefine success.

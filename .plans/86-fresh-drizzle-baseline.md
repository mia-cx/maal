# #86 Generate a fresh Drizzle baseline for rewrite launch

## Summary

Replace the rewrite's incremental migration history with one baseline generated from the current Drizzle schema. The launch process resets the existing environment D1 before applying this baseline.

## Acceptance criteria

- [ ] Drizzle generates one fresh baseline with no prototype bridge or legacy migration files.
- [ ] The fresh baseline matches the old chain's normalized empty-D1 schema fingerprint.
- [ ] Applying the baseline to a populated prototype schema fails closed.
- [ ] The cutover runbook bookmarks, confirms, resets, verifies empty, applies, and verifies the existing environment D1.
- [ ] Focused D1 tests, staging contracts, and full validation pass without a remote operation.

## TODOs

- [x] Add a migration-runner contract that records the old chain fingerprint and requires schema equivalence.
- [x] Generate and commit the fresh Drizzle baseline from the current schema.
- [x] Add the populated-prototype fail-closed contract and update migration consumers.
- [x] Generate a deterministic post-baseline D1 taxonomy seed from the canonical TypeScript seed.
- [x] Rewrite staging and production reset-first cutover instructions.
- [ ] Run focused and full validation and record exact evidence.

## Notes

- Test seam: the repository's D1 migration runner and its observable schema/migration state.
- Product decision from #85: do not preserve or bridge the prototype migration lineage.
- No remote D1, deployment, or provider command is allowed in this issue.
- The retired chain had 138 schema objects: 55 tables including D1 metadata and 83 indexes.
- Its raw normalized SQL fingerprint was `58ec0ece9b72e662541335084522b1e044aa18546d6524f4d2e8a7beed9b7aa9`.
- Its semantic fingerprint, which ignores column declaration order, was `530668bba4bd77fdb5f355a4f0ab25e2808bbd36c663bd182fff15fdc782752e`.
- Drizzle generated `drizzle/0000_rewrite_baseline.sql`; the fresh baseline has the same semantic fingerprint.
- Drizzle Kit generated the custom `drizzle/0001_global_taxonomy_seed.sql` migration shell.
- `pnpm db:generate:seed` renders that migration from the canonical TypeScript seed.
- D1 and TypeScript match at 40 units, 184 unit aliases, zero intentionally empty global food rows, affine conversions, and EN/NL plural aliases.
- `pnpm test:d1-schema` proves both files apply once, leave no pending migrations, and fail closed over populated prototype tables.
- `scripts/generate-d1-reset-sql.mjs` turns a private schema-only export into a private reset file without touching D1.
- The runbook requires a Time Travel bookmark, traffic pause, exact environment phrase, zero application objects, both applied migration names, and golden taxonomy counts.

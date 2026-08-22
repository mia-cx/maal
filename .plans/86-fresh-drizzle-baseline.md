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

- [~] Add a migration-runner contract that records the old chain fingerprint and requires schema equivalence.
- [ ] Generate and commit the fresh Drizzle baseline from the current schema.
- [ ] Add the populated-prototype fail-closed contract and update migration consumers.
- [ ] Rewrite staging and production reset-first cutover instructions.
- [ ] Run focused and full validation and record exact evidence.

## Notes

- Test seam: the repository's D1 migration runner and its observable schema/migration state.
- Product decision from #85: do not preserve or bridge the prototype migration lineage.
- No remote D1, deployment, or provider command is allowed in this issue.

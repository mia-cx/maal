## Parent PRD

#55

## What to build

Deliver the lossless local taxonomy, alias, affine-unit conversion, food preference, and display-preference slice from spec §5.5.

## Acceptance criteria

- [ ] Global seed plus user/household entries and aliases retain every prototype field and constraint.
- [ ] User, household, and global precedence is derived at query time.
- [ ] Unit conversions, paired references, locale/domain defaults, and adoption states are editable offline.
- [ ] Dexie and Effect round-trip tests prove no field loss.

## Blocked by

Local runtime and shared prototype-UI baseline slices.

## Implementation TODOs

- [x] Define field-complete Effect contracts and bundled global seed data.
- [x] Type the Dexie taxonomy stores and install the versioned seed without overwriting edits.
- [x] Add offline scoped commands, invariants, affine conversion, and query-time precedence.
- [x] Preserve the prototype display/store seam on top of Dexie live queries.
- [x] Prove lossless storage and mutation round trips, constraints, precedence, and reactivity.

## Validation

- `pnpm validate`
- 21 unit tests and the foundation browser test pass; build budget is 32,636 / 256,000 gzip bytes.

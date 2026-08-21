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

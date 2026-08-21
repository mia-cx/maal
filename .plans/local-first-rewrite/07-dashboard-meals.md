## Parent PRD

#55

## What to build

Rebuild the real offline dashboard, meal planner, copied meal aggregates, planned/cooked/skipped lifecycle, postpone behavior, and focused check-ins from spec §§5.3–5.4.

## Acceptance criteria

- [ ] Planning copies every recipe sidecar and later recipe edits do not mutate meals.
- [ ] Schedule/dashboard works from Dexie only with the three implemented statuses.
- [ ] Focused check-in is repeat/neutral/avoid, cook time, and optional thoughts only.
- [ ] Meal deletion/provenance/check-in behavior and relevant accessibility/browser tests pass.

## Blocked by

Profiles/households and recipe slices.

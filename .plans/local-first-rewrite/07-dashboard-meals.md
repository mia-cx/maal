## Parent PRD

#55

## What to build

Reconnect the prototype's finished dashboard and calendar UI to the local runtime, then deliver copied meal aggregates, planned/cooked/skipped lifecycle, postpone behavior, and focused check-ins from spec §§1.1 and 5.3–5.4. Reuse the prototype components and interaction modules; do not redesign or rebuild equivalents.

## Acceptance criteria

- [ ] Planning copies every recipe sidecar and later recipe edits do not mutate meals.
- [ ] Schedule/dashboard works from Dexie only with the three implemented statuses.
- [ ] `src/lib/interaction/scroll-sdk.ts`, the complete dashboard schedule component family, calendar/range-calendar primitives, drag/drop, keyboard planning, meal-pool, and responsive calendar modes are carried over from prototype commit `74a12ec38f6c297d1a6adbf596234c45212bac11` and adapted only at their data seams.
- [ ] Focused check-in is repeat/neutral/avoid, cook time, and optional thoughts only.
- [ ] Meal deletion/provenance/check-in behavior and relevant accessibility/browser tests pass.
- [ ] Existing prototype interaction/unit tests are retained and phone/desktop visual regression coverage proves calendar and scrolling parity.

## Blocked by

Profiles/households and recipe slices.

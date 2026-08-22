# #75 Use indexed Dexie ranges for the meal calendar

## Summary

Drive the preserved calendar's loaded-range signal into a bounded Dexie live query. Keep the approved schedule UI and interactions unchanged.

## Acceptance criteria

- [ ] Every schedule mode reports its rendered range to the plan route.
- [ ] Meal reads use `[householdId+date]` and check-in reads use `mealId`.
- [ ] Range, household, and profile changes replace the live query without HTTP hydration.
- [ ] Large-history tests prove reads stay proportional to the rendered range.
- [ ] Browser and visual coverage preserves day, multi-day, month, offline, keyboard, drag, and check-in behavior.

## TODOs

- [x] Add a bounded meal-calendar query module with read instrumentation.
- [x] Connect the schedule range callback to a replaceable Dexie live query.
- [x] Add large-history unit and performance coverage.
- [x] Extend browser interaction and visual regression coverage.
- [x] Run focused checks and the full validation suite.

## Notes

- Prototype UI authority is `main@74a12ec38f6c297d1a6adbf596234c45212bac11`.
- The service worker and content HTTP paths stay outside this change.
- Focused Vitest: 3 files and 12 tests passed.
- Focused Playwright: 3 tests passed, including existing desktop and phone screenshots.
- `pnpm check`: 0 errors and 0 warnings.
- Full `pnpm validate`: lint passed, Svelte check found 0 errors and 0 warnings, 46 unit
  files and 263 tests passed, production build and 178055/256000-byte gzip budget passed,
  and 12 Playwright tests passed.

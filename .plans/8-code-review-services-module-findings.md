# #8 Code review: services module findings

## Summary
Address the remaining service-module review findings by removing UI type coupling, tightening check-in validation, preserving imported recipe timing metadata, making no-op recipe deletes observable, improving meal lookup efficiency, and wrapping remaining multi-step meal writes in transactions.

## Acceptance criteria
- [ ] Server services no longer import meal feedback types from UI components.
- [ ] Check-in request/service validation rejects malformed IDs, verdicts, booleans, and positive integers consistently.
- [ ] Multi-statement meal mutations commit atomically.
- [ ] `getHouseholdMeal` avoids loading a whole household plan just to filter one meal.
- [ ] Recipe creation preserves explicit `sourceClaimedMinutes`, and delete reports no-op deletes.
- [ ] Focused service tests and repo validation pass.

## TODOs
- [x] Add shared meal feedback/check-in validation types and update imports away from UI modules.
- [x] Tighten check-in input/service validation and tests.
- [x] Wrap remaining meal check-in/meal-plan multi-write mutations in transactions.
- [x] Add exact meal loading support and use it from `getHouseholdMeal`.
- [x] Preserve `sourceClaimedMinutes` and make recipe delete no-ops observable.
- [ ] Run focused and repo validation, then file PR.

## Notes
- Initial repo had uncommitted changes in the parent worktree; this work is isolated in `.worktrees/8-code-review-services-module-findings` from `main`.
- Existing `main` already contains several fixes from the issue: recipe import SSRF/byte-limit protection, transactions in recipe create/update, and unused `mealFromHouseholdMeal` import removal.
- Added `$lib/domain/meal-feedback` for shared verdict/capacity types so server code no longer imports UI label modules.
- Check-in parsing now rejects non-boolean `cooked` values and non-integer cook times instead of coercing them.
- Wrapped meal creation/update sidecar writes and check-in status updates in transactions.
- `loadMealPlanMeals` now accepts an optional exact `mealId`, and `getHouseholdMeal` uses it instead of loading all plan meals.
- Recipe creation now prefers explicit `sourceClaimedMinutes`; archive updates return `deleted: false` with `deletedAt: null` when no active row matched.

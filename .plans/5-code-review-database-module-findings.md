# #5 Code review: database module findings

## Summary

Harden database persistence after the db module code review: make recipe child-row replacement atomic, tighten schema constraints/enums/shared constants, stabilize meal-plan loading, and remove mapper cleanup issues.

## Acceptance criteria

- [x] Recipe ingredient/instruction replacement runs atomically.
- [x] Invalid instruction-event payloads, empty media rows, and out-of-range confidence values are rejected by schema checks.
- [x] Classification uniqueness is not bypassed by null locales.
- [x] Billing subscription statuses and taxonomy/adoption enums are centralized.
- [x] Meal-plan loading order is deterministic and dead mapper parameters/cleanup issues are removed.
- [x] Relevant checks pass or residual risks are recorded.

## TODOs

- [x] Make recipe child-row replacement transactional.
- [x] Add schema invariants for confidence ranges, instruction-event payloads, non-empty media, and classification locales.
- [x] Centralize billing status, taxonomy enum, and adoption-status constants.
- [x] Stabilize and simplify meal-plan mapper loading helpers.
- [x] Run final validation and file the PR.

## Notes

- Created worktree from `origin/main` to leave existing local changes untouched.

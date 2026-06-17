# #11 #12 #20 Schedule planning hardening

## Summary

Harden the meal planning/schedule data flow across dashboard helpers and plan routes: strict date parsing, safer API client errors/response validation, consistent meal route validation/not-found behavior, resilient range loading, and route data hydration without silent promise failures.

## Acceptance criteria

- [ ] Plan meal range endpoints reject invalid/reversed dates with 400.
- [ ] Plan meal POST/PUT reject malformed meal payloads, and PUT/DELETE return 404 when the target meal is missing.
- [ ] Schedule date helpers reject invalid date keys and month arithmetic does not overflow end-of-month dates.
- [ ] Schedule API client builds safe query strings, validates response bodies, and throws one typed error shape.
- [ ] Dashboard range loading does not drop the latest range during in-flight requests and transient failures are retryable.
- [ ] Plan page initial data is awaited server-side instead of hydrated with unhandled client promises.

## TODOs

- [x] Add neutral plan DTO/date validation helpers and update route/client imports.
- [x] Harden `/plan/meals` request parsing, range validation, and not-found semantics.
- [x] Harden schedule date helpers and API client response/error handling.
- [x] Make dashboard range loading queue latest requests and allow retries.
- [ ] Await plan page route data server-side and simplify client hydration.
- [ ] Run focused unit/check validation and update PR notes.

## Notes

- Created from `origin/main` in `.worktrees/11-12-20-schedule-hardening` because the main worktree has unrelated uncommitted changes.
- Issues reviewed: #11, #12, #20 are open.
- Added `$lib/plan/plan-types` and moved server/route/client imports off dashboard component DTOs.
- Validation: `pnpm exec tsc --noEmit --skipLibCheck` fails before typechecking because `worker-configuration.d.ts` has not been generated yet.
- Added strict date-key validation, route meal payload parsing, reversed range rejection, DELETE missing-row 404, and PUT missing-id/missing-row 400/404 handling.
- Date helpers now use strict round-trip date keys and clamp month arithmetic; schedule meal client uses `URLSearchParams`, response guards, and `ScheduleMealClientError`.
- Validation: `pnpm test:unit -- --run src/lib/components/dashboard/schedule-date.test.ts src/lib/components/dashboard/schedule-meal-client.test.ts` passed (vitest ran all 50 files, 176 tests).
- Dashboard meal range loading now queues the latest pending range while a segment is in flight and no longer permanently suppresses failed keys.
- Validation: `pnpm check` passed with 0 errors/warnings.

# #17 Billing route contracts (+ #23 billing fallout)

## Summary
Harden billing route behavior at the SvelteKit route boundary: make checkout side effects POST-only, validate billing request bodies consistently, expose household-list degradation instead of masking it, and keep Stripe pricing conversion from treating unsupported nullable prices as free.

## Acceptance criteria
- [x] Checkout creation/trial start no longer happens from a GET request.
- [x] Billing checkout and portal POST bodies reject unsupported or malformed content with explicit 400/415 errors.
- [x] Billing endpoints use a consistent API-style auth contract for route handlers.
- [x] Billing status does not silently treat household-list failures as an empty household list.
- [x] Landing/root pricing conversion skips unsupported nullable or non-recurring Stripe prices instead of coercing to 0.
- [x] Focused unit coverage validates the hardened parsing/pricing/status behavior.

## TODOs
- [x] Add shared billing route request parsing helpers and make checkout/portal POSTs reject malformed or unsupported bodies while GET checkout stays side-effect free.
- [x] Make billing status expose household-list degradation instead of masking failures as no households.
- [x] Harden landing pricing conversion and trial-price selection against unsupported nullable/non-recurring Stripe prices.
- [x] Add focused tests for billing route parsers, degraded billing status, and landing pricing conversion.
- [x] Run focused and repo validation, then file a PR.

## Notes
- Issue #17 is open. Issue #23 is open; this plan only includes billing-related pricing/status fallout per user scope.
- Initial code read: checkout route currently has side-effecting GET and raw formData POST; portal swallows JSON parse failures; status-view catches household-list errors to []; root page uses `unit_amount ?? 0`.
- Completed request parsing TODO: `GET /billing/checkout` now returns 405 without creating checkout/trials; checkout POST requires form content type; portal POST requires JSON object and keeps 401 auth contract.
- Validation: `pnpm test:unit -- --run src/lib/server/http/request.test.ts` passed (Vitest ran full configured unit suite: 43 files, 159 tests).
- Completed billing status degradation TODO: household-list failures are logged and exposed as `householdListDegraded: true` while retaining the active household billing status fallback.
- Validation: first `pnpm test:unit -- --run src/lib/server/billing/status-view.test.ts` failed due Vitest mock hoisting; fixed with `vi.hoisted`. Re-run passed (44 files, 161 tests).
- Completed pricing hardening TODO: landing and billing pricing now accept only active fixed recurring licensed prices with finite unit amounts; trial ID selection applies the same fixed-recurring guard to zero-amount prices.
- Validation: first `pnpm test:unit -- --run src/lib/server/billing/pricing-options.test.ts src/routes/page.server.test.ts` failed because existing test price overrides replaced `usage_type`; fixed test fixture merge. Re-run passed (45 files, 164 tests).
- Final validation: first combined validation failed in `pnpm check` due duplicate test fixture property and strict Stripe recurring mock types; fixed and amended pricing commit.
- Final validation passed: `pnpm check`; `pnpm test:unit -- --run src/lib/server/billing src/lib/server/http/request.test.ts src/routes/page.server.test.ts` (45 files, 164 tests); `pnpm architecture:check`.

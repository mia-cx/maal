# #4 Code review: billing module findings

## Summary

Fix billing review findings around Stripe price policy, trial cleanup, webhook safety, configuration errors, entitlements cache growth, API cleanup, and small billing module cleanups.

## Acceptance criteria

- [ ] Stripe checkout/trial price selection does not miss valid prices beyond the first page.
- [ ] Pricing eligibility/order is shared across display, checkout validation, and trial default selection.
- [ ] Null amount prices are not treated as free/trial options.
- [ ] Trial rollback cleans up external Stripe resources and preserves the original failure.
- [ ] Checkout completion webhooks skip sessions without subscription data.
- [ ] Stripe configuration failures are descriptive and not masked as signature errors.
- [ ] Entitlement cache evicts expired entries and access APIs only accept used inputs.
- [ ] Low-priority cleanups are applied and billing checks pass.

## TODOs

- [x] Centralize billing price policy and trial default pagination.
- [x] Harden trial rollback for created Stripe resources and cleanup failures.
- [x] Skip non-subscription checkout completion webhooks and separate webhook config errors.
- [x] Clean up entitlements cache/API and period-end conversion.
- [x] Replace Stripe pricing test casts with typed fixture helpers.
- [ ] Run final billing validation.

## Notes

- Created worktree `.worktrees/4-code-review-billing-module-findings` from `origin/main` to leave existing root changes untouched.
- Issue #4 includes many findings; current `main` already retrieves checkout prices directly and rejects `unit_amount === null`, but trial defaults, cleanup, webhook skip semantics, config masking, cache eviction, API cleanup, timestamp conversion, and fixture casts still need work.
- Centralized trial default selection through pricing option policy and switched Stripe price listing to auto-pagination.
- Validation: `pnpm test:unit -- --run src/lib/server/billing/pricing-options.test.ts` passed (Vitest ran the configured suite plus the targeted file).
- Trial rollback now cancels created subscriptions, deletes created customers, keeps local cleanup isolated, and throws an aggregate error when cleanup is incomplete while preserving the original cause.
- Validation: `pnpm check` failed before typechecking because `worker-configuration.d.ts` is missing; will regenerate/check in final validation.
- Checkout completion webhooks now return without upserting unless the session is subscription-mode with a present subscription. Webhook secret is resolved before signature verification so server config errors are not caught as bad signatures.
- Validation: `pnpm exec tsc --noEmit --skipLibCheck` also stops on missing `worker-configuration.d.ts`; final validation will regenerate it.
- Entitlement grant cache now deletes expired entries on read; entitlements APIs no longer accept unused `database`; removed dead status-view import; period end conversion handles timestamp `0`.
- While validating, fixed the paginated trial price call to use Stripe's typed `autoPagingEach` and tightened the pricing option type guard.
- Validation: `pnpm gen` regenerated/checks worker types, then `pnpm check` passed.
- Pricing tests now use typed recurring/override helpers, leaving one boundary cast in the price builder instead of repeated per-case Stripe casts.
- Validation: `pnpm test:unit -- --run src/lib/server/billing/pricing-options.test.ts` passed; `pnpm check` passed.

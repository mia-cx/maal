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
- [ ] Centralize billing price policy and trial default pagination.
- [ ] Harden trial rollback for created Stripe resources and cleanup failures.
- [ ] Skip non-subscription checkout completion webhooks and separate webhook config errors.
- [ ] Clean up entitlements cache/API and period-end conversion.
- [ ] Replace Stripe pricing test casts with typed fixture helpers.
- [ ] Run final billing validation.

## Notes
- Created worktree `.worktrees/4-code-review-billing-module-findings` from `origin/main` to leave existing root changes untouched.
- Issue #4 includes many findings; current `main` already retrieves checkout prices directly and rejects `unit_amount === null`, but trial defaults, cleanup, webhook skip semantics, config masking, cache eviction, API cleanup, timestamp conversion, and fixture casts still need work.

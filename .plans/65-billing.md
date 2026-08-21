# #65 Implement billing, trials, grace, and household deletion

## Summary

Replace the prototype's request-time Stripe status checks with a canonical D1 billing projection, mirrored into the shared Dexie database for local-first reads. Preserve the approved billing and household-settings UI while adding the complete Stripe lifecycle and recoverable deletion saga.

## Acceptance criteria

- [ ] Weekly, monthly, and yearly checkout use one Maal product and grant one capability.
- [ ] Trial claims are independently unique by WorkOS user and household and rollback safely.
- [ ] Signed Stripe webhooks are idempotent, tolerate reordering, and project capability in D1.
- [ ] `past_due` and `paused` share one continuous 30-day grace window reset only by payment.
- [ ] Billing ownership transfers only to an active household admin.
- [ ] Household deletion cancels, issues a real prorated cash refund, remains recoverable for 30 days, then purges.
- [ ] Authenticated Worker routes verify current projected membership and permissions.
- [ ] The browser reads billing state from Dexie and free routine use sends no billing request.
- [ ] Stripe test-mode and WorkOS staging proof results are recorded with disposable fixtures cleaned up.

## TODOs

- [x] Implement billing contracts, capability projection, D1 event/claim/deletion repositories, and focused tests.
- [~] Implement Stripe checkout, trial, webhook, transfer, refund/deletion services and authenticated routes.
- [ ] Reconnect the approved prototype billing/settings UI to Dexie and explicit online actions.
- [ ] Run local validation and the disposable real-service proof; record redacted evidence.

## Notes

- Prototype authority: `74a12ec38f6c297d1a6adbf596234c45212bac11`.
- Stripe and D1 remain canonical. The WorkOS `maal` entitlement is accepted only if the staging matrix proves it.
- Routine local capability reads never contact the Worker.
- Validation: `pnpm test:unit -- tests/unit/billing-capability.spec.ts tests/unit/server-schema.spec.ts` (74 tests passed across the unit project).

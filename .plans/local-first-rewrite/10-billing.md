## Parent PRD

#55

## What to build

Implement the one-product Stripe lifecycle, one-trial-per-user-and-household claims, direct webhook projection, optional WorkOS entitlement proof, billing transfer, grace, refund, and household deletion saga from spec §7.3.

## Acceptance criteria

- [ ] Weekly/monthly/yearly and trial flows grant the same Maal capability.
- [ ] Trial claims and webhook handling are idempotent and survive rollback/reordering.
- [ ] Past-due/paused grace lasts one continuous 30 days and local use never stops.
- [ ] Billing transfer, prorated cash refund, 30-day recovery, and final purge are proven in test mode.

## Blocked by

Auth-slot, profiles/households, and server-schema slices.

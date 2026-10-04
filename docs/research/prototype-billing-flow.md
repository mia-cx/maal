# Prototype billing flow

Research date: 2026-08-21

Prototype baseline: `74a12ec38f6c297d1a6adbf596234c45212bac11`

## Finding

The prototype uses Stripe directly because its billing lifecycle is more specific than a single product-to-entitlement mapping:

- A household owns one subscription, while one WorkOS user remains its subscriber and billing manager.
- One Stripe product may expose weekly, monthly, yearly, and zero-price trial options.
- A creator may claim one trial across all households. Maal creates that trial subscription directly, without a payment method, and rolls back partial Stripe and D1 state if creation fails.
- Stripe metadata carries both the household and subscriber identities so asynchronous webhooks can reconcile the correct D1 row.
- WorkOS organization metadata can independently grant free, lifetime, employee, beta, reward, or household-specific access.

Primary sources:

- [Checkout and household ownership](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/billing/checkout.ts)
- [Price and interval handling](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/billing/pricing-options.ts)
- [Trial claiming and rollback](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/billing/trials.ts)
- [Stripe subscription projection](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/billing/subscriptions.ts)
- [Stripe webhook reconciliation](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/billing/webhook.ts)
- [WorkOS metadata grants](https://github.com/mia-cx/maal/blob/74a12ec38f6c297d1a6adbf596234c45212bac11/src/lib/server/billing/entitlements.ts)

## Architectural consequence

WorkOS Stripe Entitlements is not a drop-in replacement for this lifecycle. V1 should keep Stripe authoritative for commercial subscription state and retain a D1 billing projection for checkout, portal, webhook idempotency, trial claims, and reconciliation.

To keep free application traffic away from D1, mirror only the effective `sync` grant into WorkOS organization metadata and the AuthKit token. A stale launch check can refresh AuthKit without querying D1. The browser starts synchronization only when its Dexie entitlement projection is active, and every sync route rejects a missing WorkOS grant before opening D1.

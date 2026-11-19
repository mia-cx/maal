# Billing service proof

Run on 2026-08-21 against Stripe test mode and the WorkOS staging environment.

## Result

The disposable service proof passed:

- one Stripe product carried weekly, monthly, and yearly recurring prices;
- Checkout created a subscription session for each interval;
- a Stripe trial subscription entered `trialing`;
- a paid subscription entered `active` and received the product's single Maal entitlement feature;
- cancelling without Stripe credit followed by a charge refund produced a successful cash refund;
- a disposable WorkOS organization stored and returned its Stripe customer link.

Redacted evidence:

```json
{
	"result": "passed",
	"mode": { "stripe": "test", "workos": "staging" },
	"checks": {
		"oneProductThreeIntervals": true,
		"workosOrganizationLinksStripeCustomer": true,
		"weeklyMonthlyYearlyCheckoutCreated": true,
		"trialCreated": true,
		"paidSubscriptionCreated": true,
		"oneProductGrantsMaalCapability": true,
		"cashRefundCreated": true
	},
	"cleanup": { "attempted": 15, "failed": [] }
}
```

All proof objects were disposable. The script expired open Checkout sessions, cancelled subscriptions, deleted customers and the WorkOS organization, archived prices and product, detached the product feature, and archived the entitlement feature. Cleanup reported no failures.

## WorkOS entitlement decision

The staging API proves that WorkOS can retain a Stripe customer ID on the household organization. It does not provide a service-side assertion that the Stripe entitlement appears in AuthKit session claims without relying on dashboard-only configuration. That optional bridge is therefore not accepted as a correctness dependency in v1. Stripe webhooks projected into D1 remain canonical; a later WorkOS entitlement mirror may be added only after a repeatable staging claim test exists.

## Reproduction

Load the staging/test environment without printing it, then run:

```sh
pnpm test:proof:billing
```

The script refuses keys that are not `sk_test_` and always attempts cleanup in `finally`.

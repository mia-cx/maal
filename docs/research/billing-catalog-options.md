# Billing catalog options for Maal sync

Research date: 2026-08-21

## Decision

Use one public Stripe Product, `Maal household sync`, with three recurring Prices:

- `maal_sync_weekly_v1`
- `maal_sync_monthly_v1`
- `maal_sync_yearly_v1`

Create one Stripe Feature with the lookup key `sync`. Attach it to that Product before creating subscriptions. Stripe attaches features to Products, while Prices define amount and billing interval. Stripe recommends multiple recurring Prices on one Product when the same service has different billing intervals. [Stripe Entitlements](https://docs.stripe.com/billing/entitlements), [Stripe products and prices](https://docs.stripe.com/products-prices/how-products-and-prices-work)

Do not create a Product per interval. It adds three copies of the same feature mapping and does not improve the WorkOS claim.

For lifetime, employee, beta, and reward grants, use at most one private `Maal sync grant` Product. Attach the same `sync` Feature and give it a private zero-price recurring Price. An active zero-price subscription then uses the same Stripe-to-WorkOS entitlement path. Put the grant reason in subscription metadata. End temporary grants by canceling the subscription at the chosen date. Leave a lifetime grant active until the user revokes it or Maal closes the program. Stripe permits zero-amount recurring Prices, and Stripe creates product entitlements from subscriptions. [Stripe Price API](https://docs.stripe.com/api/prices/create), [Stripe Billing API model](https://docs.stripe.com/billing/billing-apis)

This grant Product is an operational exception. It is not a separate entitlement. Both Products map to the same `sync` Feature.

## Why this fixes the likely catalog problem

WorkOS does not map Price IDs or plan names into the AuthKit token. Stripe computes active Feature entitlements from the Products on a Customer's active subscriptions. WorkOS copies those entitlements into the session's `entitlements` claim. A weekly, monthly, or yearly Price on the same Product therefore produces the same `sync` entitlement. [Stripe Entitlements](https://docs.stripe.com/billing/entitlements), [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe)

The household boundary also lines up. Each Maal household is a WorkOS organization. Each organization stores one Stripe Customer ID. A user session selects one organization. The AuthKit token carries that selected `org_id`. The exact claim behavior for a user in both paid and unpaid organizations still needs the dashboard test below. The organization-scoped conclusion is an inference from WorkOS's Customer mapping and session model, not an explicit WorkOS statement. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe), [WorkOS sessions](https://workos.com/docs/authkit/sessions)

## Options compared

| Option                                                 | Result                                                                                                                                                                        | Verdict                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A. One Product with weekly, monthly, and yearly Prices | One feature attachment. Every billing interval yields `sync`. Price changes stay inside one access bundle.                                                                    | Use this for paid plans.                                                                                           |
| B. One Product per interval or paid tier               | Works only if `sync` is attached to every Product. Adds duplicate configuration and a missing-feature failure mode.                                                           | Use only when tiers include different features, tax treatment, or customer-facing products. None apply to Maal v1. |
| C. One Product per entitlement or grant reason         | Useful when Products contain different feature bundles. Maal has one effective feature, so separate lifetime, employee, beta, and reward Products add no authorization value. | Do not use. One private grant Product is enough if grants must flow through Stripe.                                |

Stripe itself describes Products as the offered service and Prices as the amount and recurrence. It recommends multiple Prices for one service sold at several intervals. It describes separate Products for distinct SaaS tiers with different offerings. [Stripe products and prices](https://docs.stripe.com/products-prices/how-products-and-prices-work)

## Dashboard configuration

### Stripe test mode

1. Create Feature `Maal remote sync` with immutable lookup key `sync`.
2. Create Product `Maal household sync` and attach `sync`.
3. Add recurring weekly, monthly, and yearly Prices. Give each a stable lookup key.
4. Optionally create Product `Maal sync grant`, attach `sync`, and add one private zero-price recurring Price.
5. Create all test subscriptions only after the Feature attachment. Stripe delays a newly attached feature for existing subscriptions until their next billing period. [Stripe Entitlements](https://docs.stripe.com/billing/entitlements)

Do not encode the interval in a Feature. The application checks only `entitlements.includes("sync")`.

### WorkOS staging

1. Open Authentication, then Add-ons, then enable Stripe Entitlements.
2. Connect the standard Stripe account through Stripe Connect.
3. Do not connect a Stripe Sandbox. WorkOS does not support Stripe Sandbox accounts. Use the connected account's test mode. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe)
4. Create one staging WorkOS organization per test household.
5. Create one Stripe test Customer per organization.
6. Set that test Customer ID on the WorkOS organization through the WorkOS API or SDK.
7. Add test users as organization members and sign in with that organization selected.
8. After each subscription change, refresh the AuthKit session and replace the sealed cookie. WorkOS exposes new entitlements only after login or session refresh. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe), [WorkOS session helpers](https://workos.com/docs/reference/authkit/session-helpers)

WorkOS staging and production keep separate users, organizations, keys, and connections. Nothing in this test needs a production WorkOS organization or a live Stripe object. [WorkOS environments](https://workos.com/docs/authkit/environments)

## Minimal dashboard test matrix

Run these cases with WorkOS staging and Stripe test mode. Record the Stripe subscription status, active Stripe entitlements, refreshed WorkOS `org_id`, and refreshed WorkOS `entitlements` claim.

| Case                | Setup and action                                                                                                                | Required result                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unpaid household    | Link an organization to a test Customer with no subscription. Refresh its session.                                              | No `sync` claim.                                                                                                                                                                                                       |
| Paid intervals      | Start weekly, then switch the same subscription to monthly and yearly Prices on `Maal household sync`. Refresh after each step. | `sync` appears for all three. It never duplicates or changes name.                                                                                                                                                     |
| Second member       | Add another user to the paid WorkOS organization and refresh their organization-scoped session.                                 | The second member receives `sync`.                                                                                                                                                                                     |
| Trial               | Create a new subscription in `trialing` status. Refresh during the trial, then advance or end the trial.                        | `sync` appears during the trial if trials grant remote sync, and remains after successful activation. Treat failure here as a rejected integration assumption. WorkOS does not document trial-specific claim behavior. |
| Revoke              | Cancel the paid subscription. Refresh after Stripe removes the active entitlement.                                              | `sync` disappears.                                                                                                                                                                                                     |
| Special grant       | Create a zero-price subscription on `Maal sync grant`, then cancel it.                                                          | `sync` appears while active and disappears after cancellation.                                                                                                                                                         |
| Multiple households | Put one user in a paid organization and an unpaid organization. Switch the session between them.                                | The refreshed claim follows the selected organization. This proves whether personal recipe sync can rely on "any paid household" without extra enumeration.                                                            |

The integration is accepted only if all required results pass. The trial and multi-household cases are the two likely rejection points.

## Known constraints

- **Trials need a real test.** Stripe says a `trialing` subscription is safe to provision, but WorkOS does not state whether its Stripe add-on includes the Feature during `trialing`. [Stripe subscription trials](https://docs.stripe.com/billing/subscriptions/trials), [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe)
- **One trial per user across households is not a catalog rule.** Stripe subscriptions and WorkOS entitlement mapping operate on the household Customer. If Maal keeps a global one-trial-per-user policy, it still needs its own claim ledger or must relax the rule to one trial per household.
- **Feature attachment is not immediately retroactive.** A Feature added to a Product reaches existing subscriptions at their next billing period. Attach `sync` before the first subscription. [Stripe Entitlements](https://docs.stripe.com/billing/entitlements)
- **Price amounts are immutable records.** To change an amount, create a new Price, move new or selected subscriptions to it, and archive the old Price. Existing subscriptions on an archived Price stay active. [Stripe price management](https://docs.stripe.com/products-prices/manage-prices)
- **Interval switches affect billing.** Moving between weekly, monthly, and yearly Prices resets the billing period to the switch date and can invoice immediately. Preview or set proration behavior deliberately. [Stripe subscription price changes](https://docs.stripe.com/billing/subscriptions/change-price)
- **WorkOS does not support Stripe Sandboxes.** The supported non-production path is Stripe test mode on a standard connected account. Stripe test and live objects remain isolated. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe), [Stripe testing environments](https://docs.stripe.com/testing-use-cases)
- **Session data is cached.** A new or revoked entitlement is not visible to Maal until login or session refresh. A successful refresh can rotate the sealed session, so Maal must save the returned cookie. [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe), [WorkOS sessions](https://workos.com/docs/authkit/sessions)
- **Special grants are subscriptions in this model.** Stripe documents subscription-derived active entitlements and retrieval APIs. It does not document a manual active-entitlement grant endpoint. A one-time lifetime purchase alone therefore cannot feed WorkOS Stripe Entitlements. It needs a companion zero-price subscription or a separate custom grant path. [Stripe Entitlements](https://docs.stripe.com/billing/entitlements), [Stripe Active Entitlement API](https://docs.stripe.com/api/entitlements/active-entitlement)

## Architecture consequence

The catalog can simplify ordinary billing to one Product, three Prices, and one Feature. It cannot prove the WorkOS integration from documentation alone. Run the staging test matrix before removing Maal's direct Stripe billing projection.

If the matrix passes, AuthKit can gate sync without a D1 subscription lookup. Keep direct Stripe code only for checkout, portal, global trial policy if retained, and special-grant administration. If the matrix fails, keep Stripe as the billing authority and mirror one effective `sync` grant into a signed WorkOS claim through the existing custom path.

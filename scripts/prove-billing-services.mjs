import { randomUUID } from 'node:crypto';

import { WorkOS } from '@workos-inc/node';
import Stripe from 'stripe';

const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
const workosKey = process.env.WORKOS_API_KEY ?? '';
const workosClientId = process.env.WORKOS_CLIENT_ID ?? '';

if (!stripeKey.startsWith('sk_test_')) {
	throw new Error('Refusing to create billing proof fixtures outside Stripe test mode');
}
if (!workosKey.startsWith('sk_test_')) {
	throw new Error('Refusing to create billing proof fixtures outside WorkOS staging');
}
if (!workosClientId) throw new Error('WORKOS_CLIENT_ID is required');

const stripe = new Stripe(stripeKey);
const workos = new WorkOS(workosKey, { clientId: workosClientId });
const nonce = randomUUID();
const cleanup = [];
const evidence = {
	result: 'failed',
	mode: { stripe: 'test', workos: 'staging' },
	fixtures: {},
	checks: {},
	cleanup: { attempted: 0, failed: [] }
};

try {
	const product = await stripe.products.create({
		name: `Maal disposable proof ${nonce}`,
		metadata: { proof: 'billing-65', disposable: 'true' }
	});
	evidence.fixtures.product = redact(product.id);
	cleanup.push(async () => stripe.products.update(product.id, { active: false }));

	const feature = await stripe.entitlements.features.create({
		name: `Maal capability proof ${nonce}`,
		lookup_key: `maal_proof_${nonce.replaceAll('-', '_')}`,
		metadata: { proof: 'billing-65' }
	});
	evidence.fixtures.feature = redact(feature.id);
	cleanup.push(async () => stripe.entitlements.features.update(feature.id, { active: false }));

	const productFeature = await stripe.products.createFeature(product.id, {
		entitlement_feature: feature.id
	});
	cleanup.push(async () => stripe.products.deleteFeature(product.id, productFeature.id));

	const priceInputs = [
		['weekly', 'week', 200],
		['monthly', 'month', 500],
		['yearly', 'year', 5_000]
	];
	const prices = [];
	for (const [label, interval, unitAmount] of priceInputs) {
		const price = await stripe.prices.create({
			product: product.id,
			currency: 'eur',
			unit_amount: unitAmount,
			recurring: { interval },
			lookup_key: `maal_proof_${label}_${nonce}`,
			metadata: { proof: 'billing-65' }
		});
		prices.push(price);
		cleanup.push(async () => stripe.prices.update(price.id, { active: false }));
	}
	evidence.fixtures.prices = prices.map(({ id }) => redact(id));
	evidence.checks.oneProductThreeIntervals =
		new Set(prices.map(({ product: id }) => id)).size === 1 &&
		prices.map(({ recurring }) => recurring?.interval).join(',') === 'week,month,year';

	const checkoutCustomer = await stripe.customers.create({
		email: `maal-billing-proof+${nonce}@example.test`,
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(async () => stripe.customers.del(checkoutCustomer.id));
	evidence.fixtures.checkoutCustomer = redact(checkoutCustomer.id);

	const workosOrganization = await workos.organizations.createOrganization({
		name: `Maal disposable billing proof ${nonce}`,
		externalId: `maal-proof-${nonce}`,
		metadata: { proof: 'billing-65', disposable: 'true' }
	});
	cleanup.push(async () => workos.organizations.deleteOrganization(workosOrganization.id));
	const linkedOrganization = await workos.organizations.updateOrganization({
		organization: workosOrganization.id,
		stripeCustomerId: checkoutCustomer.id
	});
	evidence.fixtures.workosOrganization = redact(workosOrganization.id);
	evidence.checks.workosOrganizationLinksStripeCustomer =
		linkedOrganization.stripeCustomerId === checkoutCustomer.id;

	const checkoutSessions = [];
	for (const price of prices) {
		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer: checkoutCustomer.id,
			line_items: [{ price: price.id, quantity: 1 }],
			success_url: 'https://example.test/billing/success',
			cancel_url: 'https://example.test/billing/cancel',
			metadata: { proof: 'billing-65' }
		});
		checkoutSessions.push(session);
		cleanup.push(async () => {
			const current = await stripe.checkout.sessions.retrieve(session.id);
			if (current.status === 'open') await stripe.checkout.sessions.expire(session.id);
		});
	}
	evidence.checks.weeklyMonthlyYearlyCheckoutCreated = checkoutSessions.every(
		({ status, url }) => status === 'open' && Boolean(url)
	);

	const trialCustomer = await stripe.customers.create({
		email: `maal-trial-proof+${nonce}@example.test`,
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(async () => stripe.customers.del(trialCustomer.id));
	const trialSubscription = await stripe.subscriptions.create({
		customer: trialCustomer.id,
		items: [{ price: prices[1].id }],
		trial_period_days: 1,
		metadata: { proof: 'billing-65', trial_user_id: `proof-user-${nonce}` }
	});
	cleanup.push(async () => cancelIfActive(trialSubscription.id));
	evidence.fixtures.trialSubscription = redact(trialSubscription.id);
	evidence.checks.trialCreated = trialSubscription.status === 'trialing';

	const paidCustomer = await stripe.customers.create({
		email: `maal-paid-proof+${nonce}@example.test`,
		payment_method: 'pm_card_visa',
		invoice_settings: { default_payment_method: 'pm_card_visa' },
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(async () => stripe.customers.del(paidCustomer.id));
	const paidSubscription = await stripe.subscriptions.create({
		customer: paidCustomer.id,
		items: [{ price: prices[1].id }],
		payment_behavior: 'error_if_incomplete',
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(async () => cancelIfActive(paidSubscription.id));
	evidence.fixtures.paidSubscription = redact(paidSubscription.id);
	evidence.checks.paidSubscriptionCreated = paidSubscription.status === 'active';

	const activeEntitlements = await waitForEntitlement(paidCustomer.id, feature.id);
	evidence.checks.oneProductGrantsMaalCapability = activeEntitlements;

	const latestInvoiceId = objectId(paidSubscription.latest_invoice);
	if (!latestInvoiceId) throw new Error('Paid proof subscription has no invoice');
	const invoicePayments = await stripe.invoicePayments.list({
		invoice: latestInvoiceId,
		status: 'paid',
		limit: 10
	});
	const paymentIntentId = objectId(invoicePayments.data[0]?.payment?.payment_intent);
	if (!paymentIntentId) throw new Error('Paid proof invoice has no payment intent');
	const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
	const chargeId = objectId(paymentIntent.latest_charge);
	if (!chargeId) throw new Error('Paid proof payment intent has no charge');
	await stripe.subscriptions.cancel(paidSubscription.id, { prorate: false });
	const refund = await stripe.refunds.create({
		charge: chargeId,
		amount: 100,
		reason: 'requested_by_customer',
		metadata: { proof: 'billing-65', kind: 'prorated-cash-refund' }
	});
	evidence.fixtures.refund = redact(refund.id);
	evidence.checks.cashRefundCreated = refund.amount === 100 && refund.status === 'succeeded';

	assertEveryCheckPassed(evidence.checks);
	evidence.result = 'passed';
} finally {
	for (const dispose of cleanup.reverse()) {
		evidence.cleanup.attempted += 1;
		try {
			await dispose();
		} catch (error) {
			evidence.cleanup.failed.push(safeError(error));
		}
	}
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function cancelIfActive(subscriptionId) {
	const subscription = await stripe.subscriptions.retrieve(subscriptionId);
	if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
		await stripe.subscriptions.cancel(subscriptionId, { prorate: false });
	}
}

async function waitForEntitlement(customerId, featureId) {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const page = await stripe.entitlements.activeEntitlements.list({
			customer: customerId,
			limit: 100
		});
		if (page.data.some(({ feature }) => objectId(feature) === featureId)) return true;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
}

function objectId(value) {
	return typeof value === 'string' ? value : value?.id;
}

function redact(id) {
	if (!id) return null;
	return `${id.slice(0, id.indexOf('_') + 1 || 4)}…${id.slice(-6)}`;
}

function safeError(error) {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function assertEveryCheckPassed(checks) {
	const failed = Object.entries(checks).filter(([, passed]) => !passed);
	if (failed.length)
		throw new Error(`Billing proof failed: ${failed.map(([name]) => name).join(', ')}`);
}

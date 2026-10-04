import { randomUUID } from 'node:crypto';

import { NotFoundException, WorkOS } from '@workos-inc/node';
import Stripe from 'stripe';

const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
const workosKey = process.env.WORKOS_API_KEY ?? '';
const workosClientId = process.env.WORKOS_CLIENT_ID ?? '';
const configuredProductId = process.env.STRIPE_PRODUCT_ID ?? '';

if (!stripeKey.startsWith('sk_test_')) {
	throw new Error('Refusing to create billing proof fixtures outside Stripe test mode');
}
if (!workosKey.startsWith('sk_test_')) {
	throw new Error('Refusing to create billing proof fixtures outside WorkOS staging');
}
if (!workosClientId || !configuredProductId) {
	throw new Error('WORKOS_CLIENT_ID and STRIPE_PRODUCT_ID are required');
}

const stripe = new Stripe(stripeKey);
const workos = new WorkOS(workosKey, { clientId: workosClientId });
const nonce = randomUUID();
const cleanup = [];
const evidence = {
	result: 'failed',
	mode: { stripe: 'test', workos: 'staging' },
	checks: {},
	cleanup: { attempted: 0, failed: [] }
};

try {
	evidence.checks.configuredMaalProductAndPrices = await verifyConfiguredMaalCatalog();

	const product = await stripe.products.create({
		name: `Maal disposable proof ${nonce}`,
		metadata: { proof: 'billing-65', disposable: 'true' }
	});
	cleanup.push(async () => {
		await stripe.products.update(product.id, { active: false });
		assert(
			!(await stripe.products.retrieve(product.id)).active,
			'Disposable product remains active'
		);
	});

	const feature = await stripe.entitlements.features.create({
		name: `Maal capability proof ${nonce}`,
		lookup_key: `maal_proof_${nonce.replaceAll('-', '_')}`,
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(async () => {
		await stripe.entitlements.features.update(feature.id, { active: false });
		assert(
			!(await stripe.entitlements.features.retrieve(feature.id)).active,
			'Disposable feature remains active'
		);
	});

	const productFeature = await stripe.products.createFeature(product.id, {
		entitlement_feature: feature.id
	});
	cleanup.push(async () => {
		await stripe.products.deleteFeature(product.id, productFeature.id);
		const remaining = await stripe.products.listFeatures(product.id, { limit: 100 });
		assert(
			!remaining.data.some(({ id }) => id === productFeature.id),
			'Disposable product feature remains attached'
		);
	});

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
		cleanup.push(async () => {
			await stripe.prices.update(price.id, { active: false });
			assert(!(await stripe.prices.retrieve(price.id)).active, 'Disposable price remains active');
		});
	}
	evidence.checks.oneProductThreeIntervals =
		new Set(prices.map(({ product: id }) => id)).size === 1 &&
		prices.map(({ recurring }) => recurring?.interval).join(',') === 'week,month,year';

	const checkoutCustomer = await stripe.customers.create({
		email: `maal-billing-proof+${nonce}@example.test`,
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(() => deleteAndVerifyCustomer(checkoutCustomer.id));

	const workosOrganization = await workos.organizations.createOrganization({
		name: `Maal disposable billing proof ${nonce}`,
		externalId: `maal-proof-${nonce}`,
		metadata: { proof: 'billing-65', disposable: 'true' }
	});
	cleanup.push(() => deleteAndVerifyOrganization(workosOrganization.id));
	const linkedOrganization = await workos.organizations.updateOrganization({
		organization: workosOrganization.id,
		stripeCustomerId: checkoutCustomer.id
	});
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
			assert(
				(await stripe.checkout.sessions.retrieve(session.id)).status !== 'open',
				'Disposable Checkout Session remains open'
			);
		});
	}
	evidence.checks.weeklyMonthlyYearlyCheckoutCreated = checkoutSessions.every(
		({ status, url }) => status === 'open' && Boolean(url)
	);

	const trialCustomer = await stripe.customers.create({
		email: `maal-trial-proof+${nonce}@example.test`,
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(() => deleteAndVerifyCustomer(trialCustomer.id));
	const trialSubscription = await stripe.subscriptions.create({
		customer: trialCustomer.id,
		items: [{ price: prices[1].id }],
		trial_period_days: 1,
		metadata: { proof: 'billing-65', trial_user_id: `proof-user-${nonce}` }
	});
	cleanup.push(() => cancelAndVerifySubscription(trialSubscription.id));
	evidence.checks.trialCreated = trialSubscription.status === 'trialing';

	const paidCustomer = await stripe.customers.create({
		email: `maal-paid-proof+${nonce}@example.test`,
		payment_method: 'pm_card_visa',
		invoice_settings: { default_payment_method: 'pm_card_visa' },
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(() => deleteAndVerifyCustomer(paidCustomer.id));
	const paidSubscription = await stripe.subscriptions.create({
		customer: paidCustomer.id,
		items: [{ price: prices[1].id }],
		payment_behavior: 'error_if_incomplete',
		metadata: { proof: 'billing-65' }
	});
	cleanup.push(() => cancelAndVerifySubscription(paidSubscription.id));
	evidence.checks.paidSubscriptionCreated = paidSubscription.status === 'active';

	const activeEntitlements = await waitForEntitlement(paidCustomer.id, feature.id);
	evidence.checks.oneProductGrantsMaalCapability = activeEntitlements;

	const latestInvoiceId = objectId(paidSubscription.latest_invoice);
	if (!latestInvoiceId) throw new Error('Paid proof subscription has no invoice');
	const paidInvoice = await stripe.invoices.retrieve(latestInvoiceId);
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
	const charge = await stripe.charges.retrieve(chargeId);
	const item = paidSubscription.items.data[0];
	if (!item) throw new Error('Paid proof subscription has no current item');
	const periodLength = Math.max(1, item.current_period_end - item.current_period_start);
	const remaining = Math.max(0, item.current_period_end - Math.floor(Date.now() / 1_000));
	const computedRefundAmount = Math.max(
		0,
		Math.min(
			Math.floor(paidInvoice.amount_paid * Math.min(1, remaining / periodLength)),
			charge.amount - charge.amount_refunded
		)
	);
	if (computedRefundAmount <= 0) throw new Error('Paid proof computed no refundable amount');
	await stripe.subscriptions.cancel(paidSubscription.id, { prorate: false });
	const refund = await stripe.refunds.create({
		charge: chargeId,
		amount: computedRefundAmount,
		reason: 'requested_by_customer',
		metadata: { proof: 'billing-65', kind: 'prorated-cash-refund' }
	});
	evidence.checks.computedProratedCashRefund =
		refund.amount === computedRefundAmount && refund.status === 'succeeded';

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

async function cancelAndVerifySubscription(subscriptionId) {
	await cancelIfActive(subscriptionId);
	assert(
		['canceled', 'incomplete_expired'].includes(
			(await stripe.subscriptions.retrieve(subscriptionId)).status
		),
		'Disposable subscription remains active'
	);
}

async function deleteAndVerifyCustomer(customerId) {
	const customer = await stripe.customers.retrieve(customerId);
	if (!customer.deleted) await stripe.customers.del(customerId);
	assert(
		(await stripe.customers.retrieve(customerId)).deleted === true,
		'Disposable customer remains'
	);
}

async function deleteAndVerifyOrganization(organizationId) {
	try {
		await workos.organizations.deleteOrganization(organizationId);
	} catch (error) {
		if (!(error instanceof NotFoundException)) throw error;
	}
	try {
		await workos.organizations.getOrganization(organizationId);
		throw new Error('Disposable WorkOS organization remains');
	} catch (error) {
		if (!(error instanceof NotFoundException)) throw error;
	}
}

async function verifyConfiguredMaalCatalog() {
	const product = await stripe.products.retrieve(configuredProductId);
	if (product.deleted || !product.active || product.name !== 'Maal') return false;
	const page = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
	const expected = new Map([
		['maal_weekly_v1', 'week'],
		['maal_monthly_v1', 'month'],
		['maal_yearly_v1', 'year']
	]);
	if (page.data.length !== expected.size) return false;
	for (const price of page.data) {
		if (
			!price.lookup_key ||
			expected.get(price.lookup_key) !== price.recurring?.interval ||
			price.recurring.interval_count !== 1 ||
			price.recurring.usage_type !== 'licensed' ||
			price.billing_scheme !== 'per_unit' ||
			(price.unit_amount ?? 0) <= 0
		) {
			return false;
		}
		expected.delete(price.lookup_key);
	}
	return expected.size === 0;
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

function safeError(error) {
	return error instanceof Error ? error.name : 'UnknownError';
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function assertEveryCheckPassed(checks) {
	const failed = Object.entries(checks).filter(([, passed]) => !passed);
	if (failed.length)
		throw new Error(`Billing proof failed: ${failed.map(([name]) => name).join(', ')}`);
}

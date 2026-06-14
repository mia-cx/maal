import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { canManageActiveHousehold, resolveActiveHouseholdId } from '$lib/server/auth/household';
import { createStripeClient } from './stripe';
import { loadBillingStatus, upsertSubscription } from './subscriptions';
import { startHouseholdTrial } from './trials';

export const createCheckoutRedirect = async ({
	cookies,
	locals,
	platform,
	priceId,
	trialRequested,
	url
}: {
	cookies: Parameters<RequestHandler>[0]['cookies'];
	locals: App.Locals;
	platform: App.Platform | undefined;
	priceId: string;
	trialRequested: boolean;
	url: URL;
}): Promise<never> => {
	const session = locals.session;
	if (!session)
		redirect(303, `/auth/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	if (!platform?.env.DB) error(503, { message: 'Billing storage is not available.' });
	if (!priceId) error(400, { message: 'Plan is required.' });

	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(404, { message: 'No household found.' });
	if (!(await canManageActiveHousehold(platform, session, householdId))) {
		error(403, { message: 'Only household managers can subscribe.' });
	}

	const stripe = createStripeClient(platform);
	const billing = await loadBillingStatus(platform.env.DB, householdId);
	const price = await stripe.prices.retrieve(priceId);
	const trialPriceSelected = price.unit_amount === 0;
	if (trialRequested || trialPriceSelected) {
		try {
			await startHouseholdTrial({
				platform,
				user: session.user,
				householdId,
				priceId: trialPriceSelected ? null : priceId
			});
		} catch {
			redirect(303, '/subscribe');
		}
		redirect(303, '/plan?settings=billing&trial=started');
	}
	if (billing.subscriberUserId && billing.subscriberUserId !== session.user.id) {
		error(403, { message: 'Only the subscriber can manage this household subscription.' });
	}
	const customerId =
		billing.stripeCustomerId ??
		(
			await stripe.customers.create({
				email: session.user.email,
				metadata: { householdId, workosUserId: session.user.id }
			})
		).id;
	const checkout = await stripe.checkout.sessions.create({
		mode: 'subscription',
		line_items: [{ price: priceId, quantity: 1 }],
		client_reference_id: householdId,
		customer: customerId,
		metadata: { householdId, workosUserId: session.user.id },
		subscription_data: { metadata: { householdId, workosUserId: session.user.id } },
		success_url: `${url.origin}/plan?settings=billing&checkout=success`,
		cancel_url: `${url.origin}/subscribe?checkout=cancelled`
	});

	if (checkout.customer && typeof checkout.customer === 'string') {
		await upsertSubscription({
			database: platform.env.DB,
			householdId,
			customerId: checkout.customer,
			subscriberUserId: session.user.id,
			subscription: null,
			status: 'checkout_started'
		});
	}

	if (!checkout.url) error(502, { message: 'Stripe did not return a checkout URL.' });
	redirect(303, checkout.url);
};

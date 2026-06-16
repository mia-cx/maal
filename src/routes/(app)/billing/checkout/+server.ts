import type { RequestHandler } from '@sveltejs/kit';
import { createCheckoutRedirect } from '$lib/server/billing/checkout';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const priceId = url.searchParams.get('priceId')?.trim() ?? '';
	const trialRequested = url.searchParams.get('trial') === '1';
	return createCheckoutRedirect({ cookies, locals, platform, priceId, trialRequested, url });
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const form = await request.formData();
	const priceId = String(form.get('priceId') ?? '').trim();
	const trialRequested = String(form.get('trial') ?? '') === '1';
	return createCheckoutRedirect({ cookies, locals, platform, priceId, trialRequested, url });
};

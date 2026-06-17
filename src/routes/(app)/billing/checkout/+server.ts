import type { RequestHandler } from '@sveltejs/kit';
import { createCheckoutRedirect } from '$lib/server/billing/checkout';
import { readFormData } from '$lib/server/http/request';

export const GET: RequestHandler = async () =>
	new Response('Checkout creation requires POST.', {
		status: 405,
		headers: { allow: 'POST' }
	});

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const form = await readFormData(request);
	const priceId = String(form.get('priceId') ?? '').trim();
	const trialRequested = String(form.get('trial') ?? '') === '1';
	return createCheckoutRedirect({ cookies, locals, platform, priceId, trialRequested, url });
};

import { redirect, type Cookies } from '@sveltejs/kit';
import { readHouseholdCookie } from '$lib/server/auth/household';
import {
	commitOAuthReturnTo,
	commitOAuthState,
	createOAuthState,
	getLoginUrl
} from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';

const screenHintFrom = (value: string | null): 'sign-in' | 'sign-up' | undefined => {
	if (value === 'sign-in' || value === 'sign-up') return value;
	return undefined;
};

const safeReturnTo = (value: string | null): string | null => {
	if (!value?.startsWith('/')) return null;
	if (value.startsWith('//')) return null;
	return value;
};

export const redirectToAuthKit = (input: {
	cookies: Cookies;
	locals: App.Locals;
	platform: App.Platform | undefined;
	url: URL;
}): never => {
	if (input.locals.session) redirect(303, '/plan');

	const runtime = createAuthRuntime(input.platform);
	const state = createOAuthState();
	commitOAuthState(input.cookies, state, input.url);

	const returnTo = safeReturnTo(input.url.searchParams.get('returnTo'));
	if (returnTo) commitOAuthReturnTo(input.cookies, returnTo, input.url);

	redirect(
		303,
		getLoginUrl({
			runtime,
			origin: input.url.origin,
			state,
			screenHint: screenHintFrom(input.url.searchParams.get('screen_hint')),
			organizationId: readHouseholdCookie(input.cookies)
		})
	);
};

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createOAuthState, commitOAuthState, getLoginUrl } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';

const screenHintFrom = (value: string | null): 'sign-in' | 'sign-up' | undefined => {
	if (value === 'sign-in' || value === 'sign-up') return value;
	return undefined;
};

export const load: PageServerLoad = ({ cookies, locals, platform, url }) => {
	if (locals.session) redirect(303, '/');

	const runtime = createAuthRuntime(platform);
	const state = createOAuthState();
	commitOAuthState(cookies, state, url);

	redirect(
		303,
		getLoginUrl({
			runtime,
			origin: url.origin,
			state,
			screenHint: screenHintFrom(url.searchParams.get('screen_hint'))
		})
	);
};

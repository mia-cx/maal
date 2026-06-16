import { redirect } from '@sveltejs/kit';
import { settingsRedirectPath } from '$lib/settings/routes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	throw redirect(302, settingsRedirectPath());
};

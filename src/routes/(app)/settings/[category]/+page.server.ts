import { redirect } from '@sveltejs/kit';
import { isSettingsCategory, settingsRedirectPath } from '$lib/settings/routes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const category = isSettingsCategory(params.category) ? params.category : undefined;
	throw redirect(302, settingsRedirectPath(category));
};

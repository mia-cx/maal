import { redirect } from '@sveltejs/kit';

import { isSettingsCategory, settingsRedirectPath } from '$lib/settings/routes.js';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	throw redirect(
		307,
		settingsRedirectPath(isSettingsCategory(params.category) ? params.category : undefined)
	);
};

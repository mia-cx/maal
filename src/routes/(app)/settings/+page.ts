import { redirect } from '@sveltejs/kit';

import { settingsRedirectPath } from '$lib/settings/routes.js';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	throw redirect(307, settingsRedirectPath());
};

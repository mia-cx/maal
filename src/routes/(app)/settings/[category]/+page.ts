import { redirect } from '@sveltejs/kit';

import {
	isSettingsCategory,
	settingsRedirectPath,
	settingsRouteCategories
} from '$lib/settings/routes.js';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () =>
	settingsRouteCategories.map((category) => ({ category }));

export const load: PageLoad = ({ params }) => {
	throw redirect(
		307,
		settingsRedirectPath(isSettingsCategory(params.category) ? params.category : undefined)
	);
};

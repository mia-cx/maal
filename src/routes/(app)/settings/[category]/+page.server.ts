import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const settingsCategories = new Set(['account', 'security', 'notifications', 'billing']);

export const load: PageServerLoad = ({ params }) => {
	const category = settingsCategories.has(params.category) ? params.category : 'account';
	redirect(302, `/plan?settings=${category}`);
};

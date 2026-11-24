import { redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';

export const load: PageLoad = ({ data, url }) => {
	if (url.searchParams.has('authSlot') && url.searchParams.has('authStatus')) {
		throw redirect(307, `/plan${url.search}`);
	}
	return data;
};

import { redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';

export const trailingSlash = 'always';

export const load: PageLoad = ({ url }) => {
	if (url.searchParams.has('authSlot') && url.searchParams.has('authStatus')) {
		redirect(307, `/plan${url.search}`);
	}
};

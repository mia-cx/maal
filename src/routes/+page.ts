import { redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';

/** `/` opens the meal plan, keeping the query so a sign-in callback's `authSlot`/`authStatus` marker survives. */
export const load: PageLoad = ({ url }) => {
	throw redirect(307, `/plan${url.search}`);
};

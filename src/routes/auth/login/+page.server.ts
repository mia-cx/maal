import type { PageServerLoad } from './$types';
import { redirectToAuthKit } from './redirect';

export const load: PageServerLoad = ({ cookies, locals, platform, url }) =>
	redirectToAuthKit({ cookies, locals, platform, url });

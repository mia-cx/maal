import type { RequestHandler } from './$types';
import { redirectToAuthKit } from './redirect';

export const GET: RequestHandler = ({ cookies, locals, platform, url }) =>
	redirectToAuthKit({ cookies, locals, platform, url });

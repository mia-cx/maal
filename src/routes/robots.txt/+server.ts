import { canonicalOrigin } from '$lib/public-site';
import type { RequestHandler } from './$types';

const privatePaths = [
	'api',
	'auth',
	'demo',
	'household',
	'invite',
	'mcp',
	'menu',
	'onboarding',
	'plan',
	'recovery',
	'settings',
	'subscribe'
];

export const GET: RequestHandler = ({ url }) => {
	const directives =
		url.origin === canonicalOrigin
			? [
					...privatePaths.flatMap((path) => [`Disallow: /${path}`, `Disallow: /*/${path}`]),
					`Sitemap: ${canonicalOrigin}/sitemap.xml`
				]
			: ['Disallow: /'];

	return new Response(['User-agent: *', ...directives, ''].join('\n'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
};

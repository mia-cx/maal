import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { canonicalOrigin, isPublicRoute } from '$lib/public-site';

export const handle: Handle = async ({ event, resolve }) => {
	const indexable = event.url.origin === canonicalOrigin && isPublicRoute(event.route.id);
	const response = await paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) => {
				const localized = html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale));
				return indexable
					? localized
					: localized.replace('</head>', '<meta name="robots" content="noindex" /></head>');
			}
		});
	});

	if (
		indexable ||
		(event.url.origin === canonicalOrigin &&
			['/robots.txt', '/sitemap.xml'].includes(event.route.id ?? ''))
	)
		return response;

	const headers = new Headers(response.headers);
	headers.set('X-Robots-Tag', 'noindex');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};

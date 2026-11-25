import { canonicalOrigin } from '$lib/public-site';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const directives = ['User-agent: *', 'Allow: /'];
	if (url.origin === canonicalOrigin) directives.push(`Sitemap: ${canonicalOrigin}/sitemap.xml`);

	return new Response([...directives, ''].join('\n'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
};

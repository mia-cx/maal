import { expect, it } from 'vitest';

import { GET } from '../../src/routes/robots.txt/+server.js';

it.each([
	['https://maal.is', 'User-agent: *\nAllow: /\nSitemap: https://maal.is/sitemap.xml\n'],
	['https://staging.maal.is', 'User-agent: *\nAllow: /\n'],
	['http://localhost:4173', 'User-agent: *\nAllow: /\n']
])(
	'allows crawling on %s and advertises the sitemap only at the canonical origin',
	async (origin, body) => {
		const response = await GET({ url: new URL('/robots.txt', origin) } as Parameters<
			typeof GET
		>[0]);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(await response.text()).toBe(body);
	}
);

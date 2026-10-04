import { describe, expect, it } from 'vitest';

import {
	collectStaticJavaScriptFiles,
	findPageNodeIds
} from '../../scripts/check-build-budget.mjs';

describe('initial SPA build budget', () => {
	it('selects the layouts and leaf for the initial page', () => {
		const routes = [
			{ pattern: /^\/$/, page: { layouts: [0, 2], leaf: 3 } },
			{ pattern: /^\/menu\/?$/, page: { layouts: [0, 2], leaf: 5 } }
		];

		expect(findPageNodeIds(routes, '/')).toEqual([0, 2, 3]);
	});

	it('counts static imports and excludes lazy route chunks', () => {
		const manifest = {
			app: {
				name: 'entry/app',
				file: 'entry.js',
				imports: ['shared'],
				dynamicImports: ['menu']
			},
			shared: { name: 'shared', file: 'shared.js' },
			menu: { name: 'nodes/5', file: 'menu.js', imports: ['shared'] }
		};

		expect([...collectStaticJavaScriptFiles(manifest, ['entry/app'])].sort()).toEqual([
			'entry.js',
			'shared.js'
		]);
	});
});

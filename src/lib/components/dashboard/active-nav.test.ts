import { describe, expect, it } from 'vitest';
import { activeNavItemForPath } from './active-nav';

describe('activeNavItemForPath', () => {
	it.each([
		['/plan', 'meal-plan'],
		['/menu', 'my-menu'],
		['/menu/import', 'my-menu'],
		['/pantry', 'pantry'],
		['/groceries', 'grocery-rollup'],
		['/household', 'household'],
		['/subscribe', 'meal-plan']
	] as const)('maps %s to %s', (pathname, navItem) => {
		expect(activeNavItemForPath(pathname)).toBe(navItem);
	});
});

import { describe, expect, it } from 'vitest';
import { activeNavItemForPath } from './active-nav';

describe('activeNavItemForPath', () => {
	it.each([
		['/plan', 'meal-plan'],
		['/menu', 'my-menu'],
		['/menu/import', 'my-menu'],
		['/menuz', 'meal-plan'],
		['/pantry', 'pantry'],
		['/pantry-items', 'meal-plan'],
		['/groceries', 'grocery-rollup'],
		['/household', 'household'],
		['/household-old', 'meal-plan'],
		['/subscribe', 'meal-plan']
	] as const)('maps %s to %s', (pathname, navItem) => {
		expect(activeNavItemForPath(pathname)).toBe(navItem);
	});
});

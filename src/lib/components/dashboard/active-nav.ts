import type { DashboardNavItem } from '$lib/components/dashboard/dashboard-nav';

const routeNavItems: readonly { prefix: string; item: DashboardNavItem }[] = [
	{ prefix: '/menu', item: 'my-menu' },
	{ prefix: '/pantry', item: 'pantry' },
	{ prefix: '/groceries', item: 'grocery-rollup' },
	{ prefix: '/household', item: 'household' }
];

export const activeNavItemForPath = (pathname: string): DashboardNavItem =>
	routeNavItems.find(({ prefix }) => pathname.startsWith(prefix))?.item ?? 'meal-plan';

import type { DashboardNavItem } from '$lib/components/dashboard/dashboard-nav';

const routeNavItems: readonly { prefix: string; item: DashboardNavItem }[] = [
	{ prefix: '/menu', item: 'my-menu' },
	{ prefix: '/pantry', item: 'pantry' },
	{ prefix: '/groceries', item: 'grocery-rollup' },
	{ prefix: '/household', item: 'household' }
];

const matchesRoutePrefix = (pathname: string, prefix: string): boolean =>
	pathname === prefix || pathname.startsWith(`${prefix}/`);

export const activeNavItemForPath = (pathname: string): DashboardNavItem =>
	routeNavItems.find(({ prefix }) => matchesRoutePrefix(pathname, prefix))?.item ?? 'meal-plan';

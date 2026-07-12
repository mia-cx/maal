import { describe, expect, it } from 'vitest';
import {
	clientDbSchemaVersion,
	clientDbStores,
	householdScopedKey,
	routeCacheTtlMs,
	userScopedKey
} from './schema';

describe('client Dexie schema', () => {
	it('keeps a versioned user-keyed household schema for lazy local-first data', () => {
		expect(clientDbSchemaVersion).toBe(1);
		expect(Object.keys(clientDbStores)).toEqual([
			'users',
			'households',
			'householdMembers',
			'planRoutes',
			'menuRoutes',
			'recipes',
			'plannedMeals',
			'mealCheckIns',
			'foodProfiles',
			'billingEntitlements',
			'uiStates',
			'syncCursors',
			'syncOutbox'
		]);
		expect(clientDbStores.planRoutes).toContain('[userId+householdId]');
		expect(clientDbStores.menuRoutes).toContain('[userId+householdId]');
		expect(clientDbStores.syncOutbox).toContain('[userId+householdId]');
	});

	it('uses stable user and household scoped cache keys', () => {
		expect(userScopedKey('user_1', 'household_1')).toBe('user_1:household_1');
		expect(householdScopedKey('user_1', 'household_1', 'route:plan')).toBe(
			'user_1:household_1:route:plan'
		);
	});

	it('defines a finite route cache ttl', () => {
		expect(routeCacheTtlMs).toBeGreaterThan(0);
		expect(routeCacheTtlMs).toBeLessThanOrEqual(1000 * 60 * 60 * 24);
	});
});

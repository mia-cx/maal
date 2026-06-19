import type { HouseholdMember, Meal } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';
import { getClientDb } from './db';
import { householdScopedKey, routeCacheTtlMs, type CachedMenuRoute, type CachedPlanRoute } from './schema';

export type PlanRouteCacheEntry = {
	meals: Meal[];
	householdMembers: HouseholdMember[];
};

export type MenuRouteCacheEntry = {
	recipes: RecipeMenuItem[];
	archivedRecipes: RecipeMenuItem[];
	nextRecipeOffset: number | null;
};

type CacheScope = {
	userId: string | null | undefined;
	householdId: string | null | undefined;
};

const planCacheId = 'route:plan';
const menuCacheId = 'route:menu';

const cloneMeal = (meal: Meal): Meal => ({
	...meal,
	ingredients: meal.ingredients ? [...meal.ingredients] : undefined,
	instructions: meal.instructions ? [...meal.instructions] : undefined
});

const cloneRecipe = (recipe: RecipeMenuItem): RecipeMenuItem => ({
	...recipe,
	ingredients: recipe.ingredients
		? recipe.ingredients.map((ingredient) => ({ ...ingredient }))
		: undefined,
	instructions: recipe.instructions
		? recipe.instructions.map((instruction) => ({ ...instruction }))
		: undefined
});

const clonePlanEntry = (entry: PlanRouteCacheEntry): PlanRouteCacheEntry => ({
	meals: entry.meals.map(cloneMeal),
	householdMembers: entry.householdMembers.map((member) => ({ ...member }))
});

const cloneMenuEntry = (entry: MenuRouteCacheEntry): MenuRouteCacheEntry => ({
	recipes: entry.recipes.map(cloneRecipe),
	archivedRecipes: entry.archivedRecipes.map(cloneRecipe),
	nextRecipeOffset: entry.nextRecipeOffset
});

const cacheKey = ({ userId, householdId }: CacheScope, id: string) => {
	if (!userId || !householdId) return null;
	return householdScopedKey(userId, householdId, id);
};

const isFresh = (entry: { expiresAt: number }, now = Date.now()) => entry.expiresAt > now;

export const getCachedPlanRouteData = async (
	scope: CacheScope
): Promise<PlanRouteCacheEntry | null> => {
	const db = getClientDb();
	const key = cacheKey(scope, planCacheId);
	if (!db || !key) return null;
	const entry = await db.planRoutes.get(key);
	if (!entry || !isFresh(entry)) return null;
	return clonePlanEntry(entry);
};

export const setCachedPlanRouteData = async (
	scope: CacheScope,
	entry: PlanRouteCacheEntry
): Promise<void> => {
	const db = getClientDb();
	const key = cacheKey(scope, planCacheId);
	if (!db || !key || !scope.userId || !scope.householdId) return;
	const now = Date.now();
	const cloned = clonePlanEntry(entry);
	await db.planRoutes.put({
		key,
		userId: scope.userId,
		householdId: scope.householdId,
		...cloned,
		cachedAt: now,
		expiresAt: now + routeCacheTtlMs
	} satisfies CachedPlanRoute);
};

export const getCachedMenuRouteData = async (
	scope: CacheScope
): Promise<MenuRouteCacheEntry | null> => {
	const db = getClientDb();
	const key = cacheKey(scope, menuCacheId);
	if (!db || !key) return null;
	const entry = await db.menuRoutes.get(key);
	if (!entry || !isFresh(entry)) return null;
	return cloneMenuEntry(entry);
};

export const setCachedMenuRouteData = async (
	scope: CacheScope,
	entry: MenuRouteCacheEntry
): Promise<void> => {
	const db = getClientDb();
	const key = cacheKey(scope, menuCacheId);
	if (!db || !key || !scope.userId || !scope.householdId) return;
	const now = Date.now();
	const cloned = cloneMenuEntry(entry);
	await db.menuRoutes.put({
		key,
		userId: scope.userId,
		householdId: scope.householdId,
		...cloned,
		cachedAt: now,
		expiresAt: now + routeCacheTtlMs
	} satisfies CachedMenuRoute);
};

export const clearUserRouteDataCache = async (userId: string | null | undefined): Promise<void> => {
	const db = getClientDb();
	if (!db || !userId) return;
	await db.transaction('rw', db.planRoutes, db.menuRoutes, async () => {
		await db.planRoutes.where('userId').equals(userId).delete();
		await db.menuRoutes.where('userId').equals(userId).delete();
	});
};

export const clearHouseholdRouteDataCache = async (scope: CacheScope): Promise<void> => {
	const db = getClientDb();
	if (!db || !scope.userId || !scope.householdId) return;
	await db.transaction('rw', db.planRoutes, db.menuRoutes, async () => {
		await db.planRoutes.where('[userId+householdId]').equals([scope.userId, scope.householdId]).delete();
		await db.menuRoutes.where('[userId+householdId]').equals([scope.userId, scope.householdId]).delete();
	});
};

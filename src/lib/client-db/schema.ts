import type { UnitPreferences } from '$lib/recipes/ingredient-text';
import type { UiState } from '$lib/stores/ui-state';
import type { HouseholdMember, Meal } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';

export const clientDbName = 'maal-client-cache';
export const clientDbSchemaVersion = 1;
export const routeCacheTtlMs = 1000 * 60 * 60 * 6;

export type UserScopedKey = `${string}:${string}`;
export type HouseholdScopedKey = `${string}:${string}:${string}`;

export type ClientHousehold = {
	id: string;
	name: string;
	role?: string | null;
};

export type ClientUser = {
	id: string;
	email: string | null;
	name: string | null;
	profilePictureUrl: string | null;
	emailVerified: boolean;
	updatedAt: number;
};

export type CachedHousehold = ClientHousehold & {
	userId: string;
	key: UserScopedKey;
	cachedAt: number;
};

export type CachedHouseholdMember = HouseholdMember & {
	userId: string;
	householdId: string;
	key: HouseholdScopedKey;
	cachedAt: number;
};

export type CachedPlanRoute = {
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	meals: Meal[];
	householdMembers: HouseholdMember[];
	cachedAt: number;
	expiresAt: number;
};

export type CachedMenuRoute = {
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	recipes: RecipeMenuItem[];
	archivedRecipes: RecipeMenuItem[];
	nextRecipeOffset: number | null;
	cachedAt: number;
	expiresAt: number;
};

export type CachedRecipe = RecipeMenuItem & {
	userId: string;
	householdId: string;
	key: HouseholdScopedKey;
	cachedAt: number;
	locallyDeletedAt?: number;
};

export type CachedPlannedMeal = Meal & {
	userId: string;
	householdId: string;
	key: HouseholdScopedKey;
	cachedAt: number;
	locallyDeletedAt?: number;
};

export type CachedMealCheckIn = {
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	mealId: string;
	verdict: 'repeat' | 'neutral' | 'avoid';
	cooked: boolean | null;
	cookTime: number | null;
	reason: string | null;
	checkedInAt: string | null;
	cachedAt: number;
};

export type CachedFoodProfile = {
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	unitPreferences: UnitPreferences;
	ingredientUnitOverrides: Record<string, string>;
	cachedAt: number;
	expiresAt: number;
};

export type CachedBillingEntitlement = {
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	status: string;
	locked: boolean;
	canManageSubscription: boolean;
	expiresAt: number;
	cachedAt: number;
};

export type SyncCursor = {
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	collection: string;
	cursor: string | null;
	updatedAt: number;
};

export type CachedUiState = {
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	name: string;
	state: Partial<UiState>;
	updatedAt: number;
};

export type SyncOutboxEntry = {
	id?: number;
	key: HouseholdScopedKey;
	userId: string;
	householdId: string;
	operation: string;
	entityType: string;
	entityId: string;
	payload: unknown;
	createdAt: number;
	attempts: number;
	nextAttemptAt: number | null;
};

export type RouteCacheName = 'plan' | 'menu';

export const userScopedKey = (userId: string, id: string): UserScopedKey => `${userId}:${id}`;

export const householdScopedKey = (
	userId: string,
	householdId: string,
	id: string
): HouseholdScopedKey => `${userId}:${householdId}:${id}`;

export const clientDbStores = {
	users: '&id, email, updatedAt',
	households: '&key, userId, id, cachedAt',
	householdMembers: '&key, [userId+householdId], householdId, userId, id, cachedAt',
	planRoutes: '&key, [userId+householdId], householdId, userId, expiresAt, cachedAt',
	menuRoutes: '&key, [userId+householdId], householdId, userId, expiresAt, cachedAt',
	recipes: '&key, [userId+householdId], householdId, userId, id, archivedAt, cachedAt',
	plannedMeals: '&key, [userId+householdId], householdId, userId, date, status, cachedAt',
	mealCheckIns: '&key, [userId+householdId], householdId, userId, mealId, cachedAt',
	foodProfiles: '&key, [userId+householdId], householdId, userId, expiresAt, cachedAt',
	billingEntitlements: '&key, [userId+householdId], householdId, userId, expiresAt, cachedAt',
	uiStates: '&key, [userId+householdId], householdId, userId, name, updatedAt',
	syncCursors: '&key, [userId+householdId], householdId, userId, collection, updatedAt',
	syncOutbox:
		'++id, key, [userId+householdId], householdId, userId, entityType, entityId, nextAttemptAt'
} as const;

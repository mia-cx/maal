import type { Meal } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';
import { getClientCacheScope, type ClientCacheScope } from './context';
import { logClientDbDebug } from './debug';
import {
	deleteMealFromDexie,
	deleteRecipesFromDexie,
	writeMealsToDexie,
	writeRecipesToDexie
} from './repositories';

export type SyncEntity = 'recipe' | 'plannedMeal';
export type SyncOperation = 'create' | 'update' | 'delete' | 'archive' | 'restore';

type RemoteSyncTask = () => Promise<unknown>;

const scopeOrActive = (scope?: ClientCacheScope | null) => scope ?? getClientCacheScope();

export const syncRecipesFromRemote = async (
	recipes: readonly RecipeMenuItem[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	logClientDbDebug('d1->dexie', 'sync recipes from remote', {
		scope: scopeOrActive(scope),
		count: recipes.length,
		ids: recipes.map((recipe) => recipe.id)
	});
	await writeRecipesToDexie(recipes, scope);
};

export const syncMealsFromRemote = async (
	meals: readonly Meal[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	logClientDbDebug('d1->dexie', 'sync meals from remote', {
		scope: scopeOrActive(scope),
		count: meals.length,
		ids: meals.map((meal) => meal.id),
		extra: { dates: meals.map((meal) => meal.date ?? null) }
	});
	await writeMealsToDexie(meals, scope);
};

export const enqueueRemoteSync = async ({
	entity,
	operation,
	entityId,
	payload,
	scope
}: {
	entity: SyncEntity;
	operation: SyncOperation;
	entityId: string;
	payload: unknown;
	scope?: ClientCacheScope | null;
}): Promise<void> => {
	const activeScope = scopeOrActive(scope);
	const { getClientDb } = await import('./db');
	const { householdScopedKey } = await import('./schema');
	const db = getClientDb();
	if (!db || !activeScope) return;
	const now = Date.now();
	logClientDbDebug('dexie->d1', 'enqueue outbox', {
		scope: activeScope,
		payload: { operation, entityType: entity, entityId }
	});
	await db.syncOutbox.add({
		key: householdScopedKey(
			activeScope.userId,
			activeScope.householdId,
			`${entity}:${entityId}:${now}`
		),
		userId: activeScope.userId,
		householdId: activeScope.householdId,
		operation,
		entityType: entity,
		entityId,
		payload,
		createdAt: now,
		attempts: 0,
		nextAttemptAt: now
	});
};

export const queueRemoteSync = async (input: {
	entity: SyncEntity;
	operation: SyncOperation;
	entityId: string;
	payload: unknown;
	remote?: RemoteSyncTask;
	scope?: ClientCacheScope | null;
}): Promise<unknown> => {
	await enqueueRemoteSync(input);
	return undefined;
};

export const removeRecipeLocally = async (
	recipeIds: readonly string[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	await deleteRecipesFromDexie(recipeIds, scope);
};

export const removeMealLocally = async (
	mealId: string,
	scope?: ClientCacheScope | null
): Promise<void> => {
	await deleteMealFromDexie(mealId, scope);
};

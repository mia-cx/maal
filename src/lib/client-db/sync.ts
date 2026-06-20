import type { Meal } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';
import { getClientCacheScope, type ClientCacheScope } from './context';
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
	await writeRecipesToDexie(recipes, scope);
};

export const syncMealsFromRemote = async (
	meals: readonly Meal[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	await writeMealsToDexie(meals, scope);
};

export const queueRemoteSync = async ({
	entity,
	operation,
	entityId,
	payload,
	remote,
	scope
}: {
	entity: SyncEntity;
	operation: SyncOperation;
	entityId: string;
	payload: unknown;
	remote: RemoteSyncTask;
	scope?: ClientCacheScope | null;
}): Promise<unknown> => {
	const activeScope = scopeOrActive(scope);
	try {
		return await remote();
	} catch (error) {
		// The outbox is intentionally best-effort for this slice: the UI writes to Dexie first,
		// then records failed remote work for the future replay worker instead of pretending the
		// D1 write succeeded.
		const { getClientDb } = await import('./db');
		const { householdScopedKey } = await import('./schema');
		const db = getClientDb();
		if (db && activeScope) {
			const now = Date.now();
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
				nextAttemptAt: now + 30_000
			});
		}
		throw error;
	}
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

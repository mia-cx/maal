import type { RecipeMenuItem } from '$lib/menu/menu-types';
import {
	archiveMenuRecipesRemote,
	createMenuRecipeRemote,
	fetchMenuRecipesPageRemote,
	importRecipeDraftFromUrlRemote,
	permanentlyDeleteMenuRecipesRemote,
	restoreMenuRecipesRemote,
	searchMenuRecipesRemote,
	updateMenuRecipeRemote
} from '$lib/menu/menu-client';
import { logClientDbDebug } from './debug';
import { deleteRecipesFromDexie, writeRecipesToDexie } from './repositories';
import { queueRemoteSync } from './sync';

export const syncRecipePageFromRemote = async (offset: number) => {
	logClientDbDebug('dexie->d1', 'fetch recipe page', { extra: { offset } });
	const body = await fetchMenuRecipesPageRemote(offset);
	logClientDbDebug('d1->dexie', 'fetched recipe page', {
		count: body.recipes.length,
		ids: body.recipes.map((recipe) => recipe.id),
		extra: { offset, nextRecipeOffset: body.nextRecipeOffset }
	});
	await writeRecipesToDexie(body.recipes);
	return body;
};

export const syncRecipeSearchFromRemote = async (
	query: string,
	options: { signal?: AbortSignal } = {}
): Promise<RecipeMenuItem[]> => {
	logClientDbDebug('dexie->d1', 'search recipes remote', { extra: { query } });
	const recipes = await searchMenuRecipesRemote(query, options);
	logClientDbDebug('d1->dexie', 'searched recipes remote', {
		count: recipes.length,
		ids: recipes.map((recipe) => recipe.id),
		extra: { query }
	});
	await writeRecipesToDexie(recipes);
	return recipes;
};

export const syncImportedRecipeDraftFromRemote = async (url: string): Promise<RecipeMenuItem> => {
	logClientDbDebug('dexie->d1', 'import recipe draft', { extra: { url } });
	const recipe = await importRecipeDraftFromUrlRemote(url);
	logClientDbDebug('d1->dexie', 'imported recipe draft', { ids: [recipe.id], payload: recipe });
	await writeRecipesToDexie([recipe]);
	return recipe;
};

export const syncCreatedRecipeToRemote = async (input: {
	title?: string;
	url?: string;
	recipe?: RecipeMenuItem;
}): Promise<RecipeMenuItem> => {
	const entityId = input.recipe?.id ?? input.url ?? input.title ?? 'new-recipe';
	return (await queueRemoteSync({
		entity: 'recipe',
		operation: 'create',
		entityId,
		payload: input,
		remote: () => createMenuRecipeRemote(input)
	})) as RecipeMenuItem;
};

export const syncUpdatedRecipeToRemote = async (recipe: RecipeMenuItem): Promise<RecipeMenuItem> =>
	(await queueRemoteSync({
		entity: 'recipe',
		operation: 'update',
		entityId: recipe.id,
		payload: recipe,
		remote: () => updateMenuRecipeRemote(recipe)
	})) as RecipeMenuItem;

export const syncArchivedRecipesToRemote = async (recipeIds: readonly string[]) => {
	const body = (await queueRemoteSync({
		entity: 'recipe',
		operation: 'archive',
		entityId: recipeIds.join(','),
		payload: { recipeIds },
		remote: () => archiveMenuRecipesRemote([...recipeIds])
	})) as { deletedAt?: string };
	return body;
};

export const syncRestoredRecipesToRemote = async (
	recipeIds: readonly string[]
): Promise<RecipeMenuItem[]> =>
	(await queueRemoteSync({
		entity: 'recipe',
		operation: 'restore',
		entityId: recipeIds.join(','),
		payload: { recipeIds },
		remote: () => restoreMenuRecipesRemote([...recipeIds])
	})) as RecipeMenuItem[];

export const syncPermanentlyDeletedRecipesToRemote = async (recipeIds: readonly string[]) => {
	await deleteRecipesFromDexie(recipeIds);
	return (await queueRemoteSync({
		entity: 'recipe',
		operation: 'delete',
		entityId: recipeIds.join(','),
		payload: { recipeIds },
		remote: () => permanentlyDeleteMenuRecipesRemote([...recipeIds])
	})) as { deletedMealCount: number };
};

export const syncRecipesFromRemoteIntoDexie = writeRecipesToDexie;

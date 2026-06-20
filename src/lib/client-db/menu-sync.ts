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
import { deleteRecipesFromDexie, writeRecipesToDexie } from './repositories';
import { queueRemoteSync } from './sync';

export const syncRecipePageFromRemote = async (offset: number) => {
	const body = await fetchMenuRecipesPageRemote(offset);
	await writeRecipesToDexie(body.recipes);
	return body;
};

export const syncRecipeSearchFromRemote = async (
	query: string,
	options: { signal?: AbortSignal } = {}
): Promise<RecipeMenuItem[]> => {
	const recipes = await searchMenuRecipesRemote(query, options);
	await writeRecipesToDexie(recipes);
	return recipes;
};

export const syncImportedRecipeDraftFromRemote = async (url: string): Promise<RecipeMenuItem> => {
	const recipe = await importRecipeDraftFromUrlRemote(url);
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

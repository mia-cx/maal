import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { importRecipeDraftFromUrlRemote } from '$lib/menu/menu-client';
import { writeRecipesToDexie } from './repositories';

export const importRecipeDraftFromUrl = async (url: string): Promise<RecipeMenuItem> => {
	const recipe = await importRecipeDraftFromUrlRemote(url);
	await writeRecipesToDexie([recipe]);
	return recipe;
};

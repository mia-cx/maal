import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { importRecipeDraftFromUrlRemote } from '$lib/menu/menu-client';

export const importRecipeDraftFromUrl = (url: string): Promise<RecipeMenuItem> =>
	importRecipeDraftFromUrlRemote(url);

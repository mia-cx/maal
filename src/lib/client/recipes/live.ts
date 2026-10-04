import { Schema } from 'effect';

import { createDecodedLiveQuery } from '$lib/client/local/live-query.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { RecipeAggregateSchema } from '$lib/domain/recipes/schema.js';

import { listRecipes, listRecoverableRecipes, searchRecipes } from './queries.js';

const RecipeListSchema = Schema.Array(RecipeAggregateSchema);

export const createRecipeLibraryLiveQuery = (
	database: MaalDatabase,
	ownerUserId: string,
	query = ''
) =>
	createDecodedLiveQuery({
		database,
		schema: RecipeListSchema,
		initialValue: [],
		query: () =>
			query.trim()
				? searchRecipes(database, ownerUserId, query)
				: listRecipes(database, ownerUserId)
	});

export const createDeletedRecipesLiveQuery = (
	database: MaalDatabase,
	ownerUserId: string,
	now: () => Date = () => new Date()
) =>
	createDecodedLiveQuery({
		database,
		schema: RecipeListSchema,
		initialValue: [],
		query: () => listRecoverableRecipes(database, ownerUserId, now())
	});

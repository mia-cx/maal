import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import {
	RecipeAggregateSchema,
	StoredRecipeSchema,
	isRecipeAggregate,
	type RecipeAggregate
} from '$lib/domain/recipes/schema.js';

export const RECIPE_RECOVERY_DAYS = 30;

const decodeStored = (record: unknown) => {
	try {
		return Schema.decodeUnknownSync(StoredRecipeSchema)(record);
	} catch {
		throw new LocalDecodeError({
			operation: 'decode local recipe',
			message: 'A local recipe did not match its contract.'
		});
	}
};

const normalizeSearch = (value: string): string[] =>
	value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

export const listRecipes = async (
	database: MaalDatabase,
	ownerUserId: string
): Promise<RecipeAggregate[]> => {
	const records = await database.recipes.where('ownerUserId').equals(ownerUserId).toArray();
	return records
		.map(decodeStored)
		.filter(
			(record): record is RecipeAggregate => isRecipeAggregate(record) && record.deletedAt === null
		)
		.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const searchRecipes = async (
	database: MaalDatabase,
	ownerUserId: string,
	query: string
): Promise<RecipeAggregate[]> => {
	const tokens = normalizeSearch(query);
	if (tokens.length === 0) return listRecipes(database, ownerUserId);
	const first = tokens[0]!;
	const indexed = await database.recipes
		.where('searchTokens')
		.startsWith(first)
		.distinct()
		.toArray();
	return indexed
		.map(decodeStored)
		.filter(
			(record): record is RecipeAggregate =>
				isRecipeAggregate(record) &&
				record.ownerUserId === ownerUserId &&
				record.deletedAt === null &&
				tokens.every((token) =>
					record.searchTokens.some((candidate) => candidate.startsWith(token))
				)
		)
		.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const listRecoverableRecipes = async (
	database: MaalDatabase,
	ownerUserId: string,
	now = new Date()
): Promise<RecipeAggregate[]> => {
	const recoveryCutoff = now.getTime() - RECIPE_RECOVERY_DAYS * 86_400_000;
	const records = await database.recipes.where('ownerUserId').equals(ownerUserId).toArray();
	return records
		.map(decodeStored)
		.filter(
			(record): record is RecipeAggregate =>
				isRecipeAggregate(record) &&
				record.deletedAt !== null &&
				Date.parse(record.deletedAt) > recoveryCutoff
		)
		.toSorted((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? ''));
};

export const getRecipe = async (
	database: MaalDatabase,
	ownerUserId: string,
	recipeId: string
): Promise<RecipeAggregate | undefined> => {
	const record = await database.recipes.get(recipeId);
	if (record === undefined) return;
	const stored = decodeStored(record);
	if (!isRecipeAggregate(stored) || stored.ownerUserId !== ownerUserId) return;
	return Schema.decodeUnknownSync(RecipeAggregateSchema)(stored);
};

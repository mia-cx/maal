import { and, eq, isNull } from 'drizzle-orm';
import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { rankRecipesByRelevance } from '$lib/menu/recipe-ranking';
import { getDb } from '$lib/server/db';
import { households, userRecipes } from '$lib/server/db/schema';
import {
	loadMenuRecipes,
	updateRecipeIngredients,
	updateRecipeInstructions
} from '$lib/server/db/recipe-mappers';
import {
	householdMealIngredients,
	householdMealInstructions,
	householdMeals,
	householdMealUserRecipes,
	userRecipeIngredients,
	userRecipeInstructions
} from '$lib/server/db/schema';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import { replaceMealRecipeSidecars } from '$lib/server/services/meal-sidecars';

type Db = ReturnType<typeof getDb>;

const unitPreferences = async (db: Db, workosUserId: string, householdId?: string | null) => {
	if (!householdId) return {};
	const profileRows = await db
		.select({ locale: households.locale })
		.from(households)
		.where(eq(households.householdId, householdId))
		.limit(1);
	return (
		await loadEffectiveTaxonomyPreferences(db, {
			workosUserId,
			householdId,
			locale: profileRows[0]?.locale ?? 'en-US'
		})
	).unitPreferences;
};

export const listUserRecipes = async (input: {
	db: Db;
	workosUserId: string;
	householdId?: string | null;
	query?: string;
	limit?: number;
	offset?: number;
	includeArchived?: boolean;
}): Promise<RecipeMenuItem[]> => {
	const recipes = await loadMenuRecipes(input.db, input.workosUserId, input.householdId, {
		unitPreferences: await unitPreferences(input.db, input.workosUserId, input.householdId),
		archive: input.includeArchived ? 'all' : 'active'
	});
	const ranked = rankRecipesByRelevance(recipes, input.query?.trim() ?? '');
	return ranked.slice(input.offset ?? 0, (input.offset ?? 0) + Math.min(input.limit ?? 25, 61));
};

export const getUserRecipe = async (input: {
	db: Db;
	workosUserId: string;
	householdId?: string | null;
	recipeId: string;
}): Promise<RecipeMenuItem> => {
	const recipe = (
		await loadMenuRecipes(input.db, input.workosUserId, input.householdId, {
			unitPreferences: await unitPreferences(input.db, input.workosUserId, input.householdId),
			recipeIds: [input.recipeId],
			archive: 'all'
		})
	)[0];
	if (!recipe) throw new Error('Recipe not found.');
	return recipe;
};

export const createUserRecipe = async (input: {
	db: Db;
	workosUserId: string;
	recipe: Pick<RecipeMenuItem, 'title'> & Partial<RecipeMenuItem>;
}): Promise<RecipeMenuItem> => {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await input.db.insert(userRecipes).values({
		id,
		workosUserId: input.workosUserId,
		title: input.recipe.title.trim() || 'Untitled recipe',
		description: input.recipe.description ?? null,
		imageUrl: input.recipe.image ?? null,
		prepTimeMinutes: input.recipe.prepTimeMinutes ?? null,
		cookTimeMinutes: input.recipe.cookTimeMinutes ?? null,
		totalTimeMinutes: input.recipe.totalTimeMinutes ?? null,
		yield: input.recipe.yield ?? null,
		sourceUrl: input.recipe.sourceUrl ?? null,
		sourceSiteName: input.recipe.sourceSiteName ?? null,
		sourceAuthorName: input.recipe.sourceAuthorName ?? null,
		sourcePublisherName: input.recipe.sourcePublisherName ?? null,
		sourceIsBasedOnUrl: input.recipe.sourceIsBasedOnUrl ?? null,
		sourceClaimedMinutes: input.recipe.cookTimeMinutes ?? null,
		userNotes: input.recipe.userNotes ?? null,
		createdAt: now,
		updatedAt: now
	});
	await updateRecipeIngredients(input.db, id, input.recipe.ingredients ?? []);
	await updateRecipeInstructions(input.db, id, input.recipe.instructions ?? []);
	return getUserRecipe({ db: input.db, workosUserId: input.workosUserId, recipeId: id });
};

type RecipePropagationSnapshot = {
	recipe: typeof userRecipes.$inferSelect;
	ingredients: string[];
	instructions: string[];
};

const orderedRecipeIngredients = async (db: Db, recipeId: string) =>
	(
		await db
			.select()
			.from(userRecipeIngredients)
			.where(eq(userRecipeIngredients.userRecipeId, recipeId))
	).toSorted((left, right) => left.lineIndex - right.lineIndex);

const orderedRecipeInstructions = async (db: Db, recipeId: string) =>
	(
		await db
			.select()
			.from(userRecipeInstructions)
			.where(eq(userRecipeInstructions.userRecipeId, recipeId))
	).toSorted((left, right) => left.stepIndex - right.stepIndex);

const linkedMealMatchesSnapshot = async (
	db: Db,
	meal: typeof householdMeals.$inferSelect,
	snapshot: RecipePropagationSnapshot
): Promise<boolean> => {
	const recipe = snapshot.recipe;
	if (
		meal.title !== recipe.title ||
		meal.description !== recipe.description ||
		meal.imageUrl !== recipe.imageUrl ||
		meal.prepTimeMinutes !== recipe.prepTimeMinutes ||
		meal.cookTimeMinutes !== recipe.cookTimeMinutes ||
		meal.totalTimeMinutes !== recipe.totalTimeMinutes ||
		meal.yield !== recipe.yield ||
		meal.sourceUrl !== recipe.sourceUrl ||
		meal.sourceSiteName !== recipe.sourceSiteName ||
		meal.sourceAuthorName !== recipe.sourceAuthorName ||
		meal.sourcePublisherName !== recipe.sourcePublisherName ||
		meal.sourceIsBasedOnUrl !== recipe.sourceIsBasedOnUrl
	) {
		return false;
	}

	const mealIngredients = (
		await db
			.select({
				lineIndex: householdMealIngredients.lineIndex,
				originalText: householdMealIngredients.originalText
			})
			.from(householdMealIngredients)
			.where(eq(householdMealIngredients.householdMealId, meal.id))
	).toSorted((left, right) => left.lineIndex - right.lineIndex);
	const mealInstructions = (
		await db
			.select({
				stepIndex: householdMealInstructions.stepIndex,
				text: householdMealInstructions.text
			})
			.from(householdMealInstructions)
			.where(eq(householdMealInstructions.householdMealId, meal.id))
	).toSorted((left, right) => left.stepIndex - right.stepIndex);

	return (
		JSON.stringify(mealIngredients.map((ingredient) => ingredient.originalText)) ===
			JSON.stringify(snapshot.ingredients) &&
		JSON.stringify(mealInstructions.map((instruction) => instruction.text)) ===
			JSON.stringify(snapshot.instructions)
	);
};

const propagateRecipeUpdateToLinkedMeals = async (
	db: Db,
	recipeId: string,
	snapshot: RecipePropagationSnapshot
) => {
	const updatedRecipe = await db
		.select()
		.from(userRecipes)
		.where(eq(userRecipes.id, recipeId))
		.get();
	if (!updatedRecipe) return;
	const linkedMeals = await db
		.select({ meal: householdMeals })
		.from(householdMealUserRecipes)
		.innerJoin(householdMeals, eq(householdMeals.id, householdMealUserRecipes.householdMealId))
		.where(eq(householdMealUserRecipes.userRecipeId, recipeId));

	for (const { meal } of linkedMeals) {
		if (!(await linkedMealMatchesSnapshot(db, meal, snapshot))) continue;
		await db
			.update(householdMeals)
			.set({
				title: updatedRecipe.title,
				description: updatedRecipe.description,
				imageUrl: updatedRecipe.imageUrl,
				prepTimeMinutes: updatedRecipe.prepTimeMinutes,
				cookTimeMinutes: updatedRecipe.cookTimeMinutes,
				totalTimeMinutes: updatedRecipe.totalTimeMinutes,
				yield: updatedRecipe.yield,
				sourceUrl: updatedRecipe.sourceUrl,
				sourceSiteName: updatedRecipe.sourceSiteName,
				sourceAuthorName: updatedRecipe.sourceAuthorName,
				sourcePublisherName: updatedRecipe.sourcePublisherName,
				sourceIsBasedOnUrl: updatedRecipe.sourceIsBasedOnUrl,
				sourceClaimedMinutes: updatedRecipe.sourceClaimedMinutes,
				updatedAt: new Date().toISOString()
			})
			.where(eq(householdMeals.id, meal.id));
		await replaceMealRecipeSidecars(db, meal.id, recipeId);
	}
};

export const updateUserRecipe = async (input: {
	db: Db;
	workosUserId: string;
	recipeId: string;
	patch: Partial<RecipeMenuItem>;
}): Promise<RecipeMenuItem> => {
	const existing = await input.db
		.select()
		.from(userRecipes)
		.where(
			and(eq(userRecipes.id, input.recipeId), eq(userRecipes.workosUserId, input.workosUserId))
		)
		.get();
	if (!existing) throw new Error('Recipe not found.');
	const propagationSnapshot: RecipePropagationSnapshot = {
		recipe: existing,
		ingredients: (await orderedRecipeIngredients(input.db, input.recipeId)).map(
			(ingredient) => ingredient.originalText
		),
		instructions: (await orderedRecipeInstructions(input.db, input.recipeId)).map(
			(instruction) => instruction.text
		)
	};
	await input.db
		.update(userRecipes)
		.set({
			title: input.patch.title ?? existing.title,
			description:
				input.patch.description === undefined ? existing.description : input.patch.description,
			imageUrl: input.patch.image === undefined ? existing.imageUrl : input.patch.image,
			prepTimeMinutes:
				input.patch.prepTimeMinutes === undefined
					? existing.prepTimeMinutes
					: input.patch.prepTimeMinutes,
			cookTimeMinutes:
				input.patch.cookTimeMinutes === undefined
					? existing.cookTimeMinutes
					: input.patch.cookTimeMinutes,
			totalTimeMinutes:
				input.patch.totalTimeMinutes === undefined
					? existing.totalTimeMinutes
					: input.patch.totalTimeMinutes,
			yield: input.patch.yield === undefined ? existing.yield : input.patch.yield,
			sourceUrl: input.patch.sourceUrl === undefined ? existing.sourceUrl : input.patch.sourceUrl,
			sourceSiteName:
				input.patch.sourceSiteName === undefined
					? existing.sourceSiteName
					: input.patch.sourceSiteName,
			sourceAuthorName:
				input.patch.sourceAuthorName === undefined
					? existing.sourceAuthorName
					: input.patch.sourceAuthorName,
			sourcePublisherName:
				input.patch.sourcePublisherName === undefined
					? existing.sourcePublisherName
					: input.patch.sourcePublisherName,
			sourceIsBasedOnUrl:
				input.patch.sourceIsBasedOnUrl === undefined
					? existing.sourceIsBasedOnUrl
					: input.patch.sourceIsBasedOnUrl,
			userNotes: input.patch.userNotes === undefined ? existing.userNotes : input.patch.userNotes,
			updatedAt: new Date().toISOString()
		})
		.where(
			and(eq(userRecipes.id, input.recipeId), eq(userRecipes.workosUserId, input.workosUserId))
		);
	if (input.patch.ingredients !== undefined) {
		await updateRecipeIngredients(input.db, input.recipeId, input.patch.ingredients);
	}
	if (input.patch.instructions !== undefined) {
		await updateRecipeInstructions(input.db, input.recipeId, input.patch.instructions);
	}
	await propagateRecipeUpdateToLinkedMeals(input.db, input.recipeId, propagationSnapshot);
	return getUserRecipe({
		db: input.db,
		workosUserId: input.workosUserId,
		recipeId: input.recipeId
	});
};

export const deleteUserRecipe = async (input: {
	db: Db;
	workosUserId: string;
	recipeId: string;
}) => {
	const deletedAt = new Date().toISOString();
	const deleted = await input.db
		.update(userRecipes)
		.set({ deletedAt, updatedAt: deletedAt })
		.where(
			and(
				eq(userRecipes.id, input.recipeId),
				eq(userRecipes.workosUserId, input.workosUserId),
				isNull(userRecipes.deletedAt)
			)
		)
		.returning({ id: userRecipes.id });
	if (!deleted.length) throw new Error('Recipe not found.');
	return { deleted: true, deletedAt };
};

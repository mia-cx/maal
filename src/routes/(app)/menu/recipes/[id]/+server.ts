import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { requireBillingAppContext } from '$lib/server/http/app-context';
import {
	householdMeals,
	householdMealUserRecipes,
	households,
	userRecipes
} from '$lib/server/db/schema';
import {
	loadMenuRecipes,
	replaceRecipeIngredients,
	replaceRecipeInstructions
} from '$lib/server/db/recipe-mappers';
import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { parseRecipeMenuItemPayload } from '$lib/menu/recipe-payload';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const readRecipe = async (request: Request): Promise<RecipeMenuItem> => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}
	if (!isRecord(body) || !isRecord(body.recipe)) error(400, { message: 'Recipe is required.' });
	const recipe = parseRecipeMenuItemPayload(body.recipe);
	if (!recipe) error(400, { message: 'Recipe payload is invalid.' });
	return recipe;
};

export const PUT: RequestHandler = async ({ cookies, locals, params, platform, request, url }) => {
	const { db, householdId, session } = await requireBillingAppContext({
		cookies,
		locals,
		platform,
		url
	});
	const recipeId = params.id;
	if (!recipeId) error(400, { message: 'Recipe is required.' });

	const recipe = await readRecipe(request);
	if (recipe.id !== recipeId) error(400, { message: 'Recipe id mismatch.' });

	const existing = await db
		.select({ id: userRecipes.id })
		.from(userRecipes)
		.where(
			and(
				eq(userRecipes.id, recipeId),
				eq(userRecipes.workosUserId, session.user.id),
				isNull(userRecipes.deletedAt)
			)
		)
		.get();
	if (!existing) error(404, { message: 'Recipe not found.' });

	await db.transaction(async (tx) => {
		await tx
			.update(userRecipes)
			.set({
				title: recipe.title,
				description: recipe.description ?? null,
				imageUrl: recipe.image ?? null,
				prepTimeMinutes: recipe.prepTimeMinutes ?? null,
				cookTimeMinutes: recipe.cookTimeMinutes ?? null,
				totalTimeMinutes: recipe.totalTimeMinutes ?? null,
				yield: recipe.yield ?? null,
				sourceUrl: recipe.sourceUrl ?? null,
				sourceSiteName: recipe.sourceSiteName ?? null,
				sourceAuthorName: recipe.sourceAuthorName ?? null,
				sourcePublisherName: recipe.sourcePublisherName ?? null,
				sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl ?? null,
				sourceClaimedMinutes: recipe.cookTimeMinutes ?? null,
				userNotes: recipe.userNotes ?? null,
				updatedAt: new Date().toISOString()
			})
			.where(
				and(
					eq(userRecipes.id, recipeId),
					eq(userRecipes.workosUserId, session.user.id),
					isNull(userRecipes.deletedAt)
				)
			);

		await replaceRecipeIngredients(tx, recipeId, recipe.ingredients ?? []);
		await replaceRecipeInstructions(tx, recipeId, recipe.instructions ?? []);
	});

	const profileRows = householdId
		? await db
				.select({ locale: households.locale })
				.from(households)
				.where(eq(households.householdId, householdId))
				.limit(1)
		: [];
	const unitPreferences = householdId
		? (
				await loadEffectiveTaxonomyPreferences(db, {
					workosUserId: session.user.id,
					householdId,
					locale: profileRows[0]?.locale ?? 'en-US'
				})
			).unitPreferences
		: {};
	const freshRecipe = (
		await loadMenuRecipes(db, session.user.id, householdId, { unitPreferences })
	).find((candidate) => candidate.id === recipeId);

	if (!freshRecipe) error(500, { message: 'Recipe was updated but could not be loaded.' });
	return json({ recipe: freshRecipe });
};

export const PATCH: RequestHandler = async ({ cookies, locals, params, platform, url }) => {
	const { db, householdId, session } = await requireBillingAppContext({
		cookies,
		locals,
		platform,
		url
	});
	const recipeId = params.id;
	if (!recipeId) error(400, { message: 'Recipe is required.' });

	const existing = await db
		.select({ id: userRecipes.id })
		.from(userRecipes)
		.where(
			and(
				eq(userRecipes.id, recipeId),
				eq(userRecipes.workosUserId, session.user.id),
				isNotNull(userRecipes.deletedAt)
			)
		)
		.get();
	if (!existing) error(404, { message: 'Archived recipe not found.' });

	const updatedAt = new Date().toISOString();
	await db
		.update(userRecipes)
		.set({ deletedAt: null, updatedAt })
		.where(
			and(
				eq(userRecipes.id, recipeId),
				eq(userRecipes.workosUserId, session.user.id),
				isNotNull(userRecipes.deletedAt)
			)
		);

	const profileRows = householdId
		? await db
				.select({ locale: households.locale })
				.from(households)
				.where(eq(households.householdId, householdId))
				.limit(1)
		: [];
	const unitPreferences = householdId
		? (
				await loadEffectiveTaxonomyPreferences(db, {
					workosUserId: session.user.id,
					householdId,
					locale: profileRows[0]?.locale ?? 'en-US'
				})
			).unitPreferences
		: {};
	const recipe = (
		await loadMenuRecipes(db, session.user.id, householdId, {
			unitPreferences,
			recipeIds: [recipeId]
		})
	)[0];

	return json({ restored: true, recipe });
};

export const DELETE: RequestHandler = async ({ cookies, locals, params, platform, url }) => {
	const { db, session } = await requireBillingAppContext({ cookies, locals, platform, url });
	const recipeId = params.id;
	if (!recipeId) error(400, { message: 'Recipe is required.' });

	const permanent = url.searchParams.get('permanent') === 'true';
	const existing = await db
		.select({ id: userRecipes.id })
		.from(userRecipes)
		.where(
			and(
				eq(userRecipes.id, recipeId),
				eq(userRecipes.workosUserId, session.user.id),
				permanent ? isNotNull(userRecipes.deletedAt) : isNull(userRecipes.deletedAt)
			)
		)
		.get();
	if (!existing)
		error(404, { message: permanent ? 'Archived recipe not found.' : 'Recipe not found.' });

	if (permanent) {
		const mealLinks = await db
			.select({ householdMealId: householdMealUserRecipes.householdMealId })
			.from(householdMealUserRecipes)
			.where(eq(householdMealUserRecipes.userRecipeId, recipeId));
		const householdMealIds = [...new Set(mealLinks.map((link) => link.householdMealId))];
		if (householdMealIds.length) {
			await db.delete(householdMeals).where(inArray(householdMeals.id, householdMealIds));
		}
		await db
			.delete(householdMealUserRecipes)
			.where(eq(householdMealUserRecipes.userRecipeId, recipeId));
		await db
			.delete(userRecipes)
			.where(
				and(
					eq(userRecipes.id, recipeId),
					eq(userRecipes.workosUserId, session.user.id),
					isNotNull(userRecipes.deletedAt)
				)
			);
		return json({ deleted: true, permanent: true, deletedMealCount: householdMealIds.length });
	}

	const deletedAt = new Date().toISOString();
	await db
		.update(userRecipes)
		.set({ deletedAt, updatedAt: deletedAt })
		.where(
			and(
				eq(userRecipes.id, recipeId),
				eq(userRecipes.workosUserId, session.user.id),
				isNull(userRecipes.deletedAt)
			)
		);

	return json({ deleted: true, deletedAt });
};

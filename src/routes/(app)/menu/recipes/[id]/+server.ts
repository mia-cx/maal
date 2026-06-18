import * as m from '$lib/paraglide/messages';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { requireBillingAppContext } from '$lib/server/http/app-context';
import { householdMeals, householdMealUserRecipes, userRecipes } from '$lib/server/db/schema';
import {
	loadMenuRecipes,
	replaceRecipeIngredients,
	replaceRecipeInstructions
} from '$lib/server/db/recipe-mappers';
import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { parseRecipeMenuItemPayload } from '$lib/menu/recipe-payload';
import { loadHouseholdUnitPreferences } from '$lib/server/taxonomy/household-preferences';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const readRecipe = async (request: Request): Promise<RecipeMenuItem> => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: m.household_invalid_request() });
	}
	if (!isRecord(body) || !isRecord(body.recipe))
		error(400, { message: m.menu_recipe_is_required() });
	const recipe = parseRecipeMenuItemPayload(body.recipe);
	if (!recipe) error(400, { message: m.menu_recipe_payload_is_invalid() });
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
	if (!recipeId) error(400, { message: m.menu_recipe_is_required() });

	const recipe = await readRecipe(request);
	if (recipe.id !== recipeId) error(400, { message: m.menu_recipe_id_mismatch() });

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
	if (!existing) error(404, { message: m.plan_recipe_not_found() });

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

	const unitPreferences = await loadHouseholdUnitPreferences(db, {
		workosUserId: session.user.id,
		householdId
	});
	const freshRecipe = (
		await loadMenuRecipes(db, session.user.id, householdId, { unitPreferences })
	).find((candidate) => candidate.id === recipeId);

	if (!freshRecipe) error(500, { message: m.menu_recipe_was_updated_but_could_not_be_loaded() });
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
	if (!recipeId) error(400, { message: m.menu_recipe_is_required() });

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
	if (!existing) error(404, { message: m.menu_archived_recipe_not_found() });

	const updatedAt = new Date().toISOString();
	await db.transaction((tx) =>
		tx
			.update(userRecipes)
			.set({ deletedAt: null, updatedAt })
			.where(
				and(
					eq(userRecipes.id, recipeId),
					eq(userRecipes.workosUserId, session.user.id),
					isNotNull(userRecipes.deletedAt)
				)
			)
	);

	const unitPreferences = await loadHouseholdUnitPreferences(db, {
		workosUserId: session.user.id,
		householdId
	});
	const recipe = (
		await loadMenuRecipes(db, session.user.id, householdId, {
			unitPreferences,
			recipeIds: [recipeId]
		})
	)[0];
	if (!recipe) error(500, { message: m.menu_recipe_was_restored_but_could_not_be_loaded() });

	return json({ restored: true, recipe });
};

export const DELETE: RequestHandler = async ({ cookies, locals, params, platform, url }) => {
	const { db, householdId, session } = await requireBillingAppContext({
		cookies,
		locals,
		platform,
		url
	});
	const recipeId = params.id;
	if (!recipeId) error(400, { message: m.menu_recipe_is_required() });

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
		const deletedMealCount = await db.transaction(async (tx) => {
			const mealLinks = await tx
				.select({ householdMealId: householdMealUserRecipes.householdMealId })
				.from(householdMealUserRecipes)
				.innerJoin(householdMeals, eq(householdMeals.id, householdMealUserRecipes.householdMealId))
				.where(
					and(
						eq(householdMealUserRecipes.userRecipeId, recipeId),
						eq(householdMeals.householdId, householdId)
					)
				);
			const householdMealIds = [...new Set(mealLinks.map((link) => link.householdMealId))];

			await tx
				.delete(householdMealUserRecipes)
				.where(eq(householdMealUserRecipes.userRecipeId, recipeId));

			let mealIdsWithoutLinks: string[] = [];
			if (householdMealIds.length) {
				const remainingLinks = await tx
					.select({ householdMealId: householdMealUserRecipes.householdMealId })
					.from(householdMealUserRecipes)
					.where(inArray(householdMealUserRecipes.householdMealId, householdMealIds));
				const linkedMealIds = new Set(remainingLinks.map((link) => link.householdMealId));
				mealIdsWithoutLinks = householdMealIds.filter((mealId) => !linkedMealIds.has(mealId));
				if (mealIdsWithoutLinks.length) {
					await tx.delete(householdMeals).where(inArray(householdMeals.id, mealIdsWithoutLinks));
				}
			}

			await tx
				.delete(userRecipes)
				.where(
					and(
						eq(userRecipes.id, recipeId),
						eq(userRecipes.workosUserId, session.user.id),
						isNotNull(userRecipes.deletedAt)
					)
				);
			return mealIdsWithoutLinks.length;
		});
		return json({ deleted: true, permanent: true, deletedMealCount });
	}

	const deletedAt = new Date().toISOString();
	await db.transaction((tx) =>
		tx
			.update(userRecipes)
			.set({ deletedAt, updatedAt: deletedAt })
			.where(
				and(
					eq(userRecipes.id, recipeId),
					eq(userRecipes.workosUserId, session.user.id),
					isNull(userRecipes.deletedAt)
				)
			)
	);

	return json({ deleted: true, deletedAt });
};

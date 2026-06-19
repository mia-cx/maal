import * as m from '$lib/paraglide/messages';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { requireBillingAppContext } from '$lib/server/http/app-context';
import { d1Batch, requireD1Database } from '$lib/server/db/d1-batch';
import {
	householdMeals,
	householdMealUserRecipes,
	userRecipeIngredients,
	userRecipeInstructionEvents,
	userRecipeInstructions,
	userRecipes
} from '$lib/server/db/schema';
import {
	loadMenuRecipes,
	maxIngredientRowsPerInsert,
	maxInstructionRowsPerInsert,
	recipeIngredientRows,
	recipeInstructionRows
} from '$lib/server/db/recipe-mappers';
import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { parseRecipeMenuItemPayload } from '$lib/menu/recipe-payload';
import { loadHouseholdUnitPreferences } from '$lib/server/taxonomy/household-preferences';
import { parseInstructionEvents } from '$lib/server/taxonomy/instruction-events';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const chunks = <T>(rows: T[], size: number): T[][] => {
	const result: T[][] = [];
	for (let index = 0; index < rows.length; index += size) {
		result.push(rows.slice(index, index + size));
	}
	return result;
};

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

	const ingredientRows = recipeIngredientRows(recipeId, recipe.ingredients ?? []);
	const instructionRows = recipeInstructionRows(recipeId, recipe.instructions ?? []);
	const instructionEventRows = (
		await Promise.all(
			instructionRows.map(async (instruction) =>
				(await parseInstructionEvents(db, instruction.text)).map((event) => ({
					userRecipeInstructionId: instruction.id,
					...event
				}))
			)
		)
	).flat();

	await d1Batch(requireD1Database(platform), [
		db
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
			),
		db.delete(userRecipeIngredients).where(eq(userRecipeIngredients.userRecipeId, recipeId)),
		...chunks(ingredientRows, maxIngredientRowsPerInsert).map((rows) =>
			db.insert(userRecipeIngredients).values(rows)
		),
		db.delete(userRecipeInstructions).where(eq(userRecipeInstructions.userRecipeId, recipeId)),
		...chunks(instructionRows, maxInstructionRowsPerInsert).map((rows) =>
			db.insert(userRecipeInstructions).values(rows)
		),
		...chunks(instructionEventRows, maxInstructionRowsPerInsert).map((rows) =>
			db.insert(userRecipeInstructionEvents).values(rows)
		)
	]);

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
	await d1Batch(requireD1Database(platform), [
		db
			.update(userRecipes)
			.set({ deletedAt: null, updatedAt })
			.where(
				and(
					eq(userRecipes.id, recipeId),
					eq(userRecipes.workosUserId, session.user.id),
					isNotNull(userRecipes.deletedAt)
				)
			)
	]);

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
		const mealLinks = await db
			.select({
				householdMealId: householdMealUserRecipes.householdMealId,
				householdId: householdMeals.householdId
			})
			.from(householdMealUserRecipes)
			.innerJoin(householdMeals, eq(householdMeals.id, householdMealUserRecipes.householdMealId))
			.where(eq(householdMealUserRecipes.userRecipeId, recipeId));
		const otherHouseholdLinks = mealLinks.filter((link) => link.householdId !== householdId);
		if (otherHouseholdLinks.length) {
			error(409, { message: 'Recipe is still planned in another household.' });
		}
		const householdMealIds = [
			...new Set(
				mealLinks
					.filter((link) => link.householdId === householdId)
					.map((link) => link.householdMealId)
			)
		];

		await d1Batch(requireD1Database(platform), [
			...(householdMealIds.length
				? [
						db
							.delete(householdMealUserRecipes)
							.where(
								and(
									eq(householdMealUserRecipes.userRecipeId, recipeId),
									inArray(householdMealUserRecipes.householdMealId, householdMealIds)
								)
							)
					]
				: [])
		]);

		let mealIdsWithoutLinks: string[] = [];
		if (householdMealIds.length) {
			const remainingLinks = await db
				.select({ householdMealId: householdMealUserRecipes.householdMealId })
				.from(householdMealUserRecipes)
				.where(inArray(householdMealUserRecipes.householdMealId, householdMealIds));
			const linkedMealIds = new Set(remainingLinks.map((link) => link.householdMealId));
			mealIdsWithoutLinks = householdMealIds.filter((mealId) => !linkedMealIds.has(mealId));
			if (mealIdsWithoutLinks.length) {
				await db.delete(householdMeals).where(inArray(householdMeals.id, mealIdsWithoutLinks));
			}
		}

		await d1Batch(requireD1Database(platform), [
			db
				.delete(userRecipes)
				.where(
					and(
						eq(userRecipes.id, recipeId),
						eq(userRecipes.workosUserId, session.user.id),
						isNotNull(userRecipes.deletedAt)
					)
				)
		]);
		return json({ deleted: true, permanent: true, deletedMealCount: mealIdsWithoutLinks.length });
	}

	const deletedAt = new Date().toISOString();
	await d1Batch(requireD1Database(platform), [
		db
			.update(userRecipes)
			.set({ deletedAt, updatedAt: deletedAt })
			.where(
				and(
					eq(userRecipes.id, recipeId),
					eq(userRecipes.workosUserId, session.user.id),
					isNull(userRecipes.deletedAt)
				)
			)
	]);

	return json({ deleted: true, deletedAt });
};

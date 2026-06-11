import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { resolveActiveHouseholdId } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { userRecipes } from '$lib/server/db/schema';
import {
	loadMenuRecipes,
	updateRecipeIngredients,
	updateRecipeInstructions
} from '$lib/server/db/recipe-mappers';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';

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
	return body.recipe as RecipeMenuItem;
};

export const PUT: RequestHandler = async ({ cookies, locals, params, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	const recipeId = params.id;
	if (!recipeId) error(400, { message: 'Recipe is required.' });

	const recipe = await readRecipe(request);
	if (recipe.id !== recipeId) error(400, { message: 'Recipe id mismatch.' });

	const db = getDb(platform.env.DB);
	const existing = await db
		.select({ id: userRecipes.id })
		.from(userRecipes)
		.where(and(eq(userRecipes.id, recipeId), eq(userRecipes.workosUserId, session.user.id)))
		.get();
	if (!existing) error(404, { message: 'Recipe not found.' });

	await db
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
		.where(eq(userRecipes.id, recipeId));

	await updateRecipeIngredients(db, recipeId, recipe.ingredients ?? []);
	await updateRecipeInstructions(db, recipeId, recipe.instructions ?? []);

	const freshRecipe = (
		await loadMenuRecipes(db, session.user.id, householdId, {
			unitPreferences: {
				preferredMassUnit: 'g' as const,
				preferredVolumeUnit: 'ml' as const,
				ingredientUnitOverrides: {}
			}
		})
	).find((candidate) => candidate.id === recipeId);

	return json({ recipe: freshRecipe ?? recipe });
};

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const recipeId = params.id;
	if (!recipeId) error(400, { message: 'Recipe is required.' });

	const db = getDb(platform.env.DB);
	const existing = await db
		.select({ id: userRecipes.id })
		.from(userRecipes)
		.where(and(eq(userRecipes.id, recipeId), eq(userRecipes.workosUserId, session.user.id)))
		.get();
	if (!existing) error(404, { message: 'Recipe not found.' });

	const updatedAt = new Date().toISOString();
	await db
		.update(userRecipes)
		.set({ deletedAt: updatedAt, updatedAt })
		.where(eq(userRecipes.id, recipeId));

	return json({ deleted: true });
};

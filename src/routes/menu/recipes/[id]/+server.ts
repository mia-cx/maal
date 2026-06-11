import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { resolveActiveHouseholdId } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import {
	householdMeals,
	householdProfiles,
	mealCheckIns,
	userRecipeApplianceRequirements,
	userRecipeIngredients,
	userRecipeInstructions,
	userRecipeNutrition,
	userRecipes
} from '$lib/server/db/schema';
import {
	loadMenuRecipes,
	schemaOrgFromRecipeItem,
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

	const recipe = await readRecipe(request);
	if (recipe.id !== params.id) error(400, { message: 'Recipe id mismatch.' });

	const db = getDb(platform.env.DB);
	const existing = await db
		.select({ id: userRecipes.id })
		.from(userRecipes)
		.where(and(eq(userRecipes.id, params.id), eq(userRecipes.workosUserId, session.user.id)))
		.get();
	if (!existing) error(404, { message: 'Recipe not found.' });

	await db
		.update(userRecipes)
		.set({
			schemaOrgRecipeJson: schemaOrgFromRecipeItem(recipe),
			sourceUrl: recipe.sourceUrl ?? null,
			sourceSiteName: recipe.sourceSiteName ?? null,
			sourceAuthorName: recipe.sourceAuthorName ?? null,
			sourcePublisherName: recipe.sourcePublisherName ?? null,
			sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl ?? null,
			sourceClaimedMinutes: recipe.cookTimeMinutes ?? null,
			userNotes: recipe.userNotes ?? null,
			updatedAt: new Date().toISOString()
		})
		.where(eq(userRecipes.id, params.id));

	await updateRecipeIngredients(db, params.id, recipe.ingredients ?? []);
	await updateRecipeInstructions(db, params.id, recipe.instructions ?? []);

	const profile = householdId
		? await db
				.select({
					preferredMassUnit: householdProfiles.preferredMassUnit,
					preferredVolumeUnit: householdProfiles.preferredVolumeUnit,
					ingredientUnitOverrides: householdProfiles.ingredientUnitOverrides
				})
				.from(householdProfiles)
				.where(eq(householdProfiles.householdId, householdId))
				.limit(1)
				.get()
		: undefined;
	const freshRecipe = (
		await loadMenuRecipes(db, session.user.id, householdId, {
			unitPreferences: {
				preferredMassUnit: profile?.preferredMassUnit ?? 'g',
				preferredVolumeUnit: profile?.preferredVolumeUnit ?? 'ml',
				ingredientUnitOverrides: profile?.ingredientUnitOverrides ?? {}
			}
		})
	).find((candidate) => candidate.id === params.id);

	return json({ recipe: freshRecipe ?? recipe });
};

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });

	const db = getDb(platform.env.DB);
	const existing = await db
		.select({ id: userRecipes.id, schemaOrgRecipeJson: userRecipes.schemaOrgRecipeJson })
		.from(userRecipes)
		.where(and(eq(userRecipes.id, params.id), eq(userRecipes.workosUserId, session.user.id)))
		.get();
	if (!existing) error(404, { message: 'Recipe not found.' });

	const updatedAt = new Date().toISOString();
	await db
		.update(householdMeals)
		.set({
			userRecipeId: null,
			recipeSnapshotJson: existing.schemaOrgRecipeJson,
			updatedAt
		})
		.where(eq(householdMeals.userRecipeId, params.id));
	await db
		.update(householdMeals)
		.set({ promotedToUserRecipeId: null, updatedAt })
		.where(eq(householdMeals.promotedToUserRecipeId, params.id));

	await db.delete(mealCheckIns).where(eq(mealCheckIns.userRecipeId, params.id));
	await db
		.delete(userRecipeApplianceRequirements)
		.where(eq(userRecipeApplianceRequirements.userRecipeId, params.id));
	await db.delete(userRecipeIngredients).where(eq(userRecipeIngredients.userRecipeId, params.id));
	await db.delete(userRecipeInstructions).where(eq(userRecipeInstructions.userRecipeId, params.id));
	await db.delete(userRecipeNutrition).where(eq(userRecipeNutrition.userRecipeId, params.id));
	await db.delete(userRecipes).where(eq(userRecipes.id, params.id));

	return json({ deleted: true });
};

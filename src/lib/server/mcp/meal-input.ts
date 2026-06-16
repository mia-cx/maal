import type { RecipeMenuItem } from '$lib/menu/menu-types';
import {
	type CreateHouseholdMealInput,
	type UpdateHouseholdMealInput
} from '$lib/server/domains/planning';
import { createUserRecipe, fetchRecipeFromUrlForImport } from '$lib/server/domains/recipes';
import { arrayOfStrings, isRecord, optionalNumber, text } from './scalars';
import { toolError } from './results';
import type { McpContext } from './context';

export const recipeFromArgs = (
	value: Record<string, unknown>
): Pick<RecipeMenuItem, 'title'> & Partial<RecipeMenuItem> => ({
	title: text(value.title) ?? 'Untitled recipe',
	description: text(value.description),
	image: text(value.image),
	sourceUrl: text(value.sourceUrl),
	sourceSiteName: text(value.sourceSiteName),
	sourceAuthorName: text(value.sourceAuthorName),
	sourcePublisherName: text(value.sourcePublisherName),
	sourceIsBasedOnUrl: text(value.sourceIsBasedOnUrl),
	prepTimeMinutes: optionalNumber(value.prepTimeMinutes, 'prepTimeMinutes'),
	cookTimeMinutes: optionalNumber(value.cookTimeMinutes, 'cookTimeMinutes'),
	yield: optionalNumber(value.yield, 'yield'),
	ingredients: (arrayOfStrings(value.ingredients, 'ingredients') ?? []).map((line) => ({
		amount: '',
		item: line
	})),
	instructions: (arrayOfStrings(value.instructions, 'instructions') ?? []).map((line, index) => ({
		position: index,
		text: line
	})),
	userNotes: text(value.userNotes)
});

export const recipePatchFromArgs = (value: Record<string, unknown>): Partial<RecipeMenuItem> => ({
	title: text(value.title),
	description: text(value.description),
	image: text(value.image),
	sourceUrl: text(value.sourceUrl),
	sourceSiteName: text(value.sourceSiteName),
	sourceAuthorName: text(value.sourceAuthorName),
	sourcePublisherName: text(value.sourcePublisherName),
	sourceIsBasedOnUrl: text(value.sourceIsBasedOnUrl),
	prepTimeMinutes: optionalNumber(value.prepTimeMinutes, 'prepTimeMinutes'),
	cookTimeMinutes: optionalNumber(value.cookTimeMinutes, 'cookTimeMinutes'),
	yield: optionalNumber(value.yield, 'yield'),
	ingredients: arrayOfStrings(value.ingredients, 'ingredients')?.map((line) => ({
		amount: '',
		item: line
	})),
	instructions: arrayOfStrings(value.instructions, 'instructions')?.map((line, index) => ({
		position: index,
		text: line
	})),
	userNotes: text(value.userNotes)
});

export const mealPatchFromArgs = (
	value: Record<string, unknown>
): UpdateHouseholdMealInput['patch'] => ({
	date: value.date === null ? null : text(value.date),
	time: value.time === null ? null : text(value.time),
	sortOrder: value.sortOrder === null ? null : optionalNumber(value.sortOrder, 'sortOrder'),
	plannedCookUserId: value.plannedCookUserId === null ? null : text(value.plannedCookUserId),
	servingsPlanned: optionalNumber(value.servingsPlanned, 'servingsPlanned'),
	status:
		value.status === 'planned' || value.status === 'cooked' || value.status === 'skipped'
			? value.status
			: undefined,
	title: text(value.title),
	description: value.description === null ? null : text(value.description),
	cookTimeMinutes:
		value.cookTimeMinutes === null
			? null
			: optionalNumber(value.cookTimeMinutes, 'cookTimeMinutes'),
	ingredients: arrayOfStrings(value.ingredients, 'ingredients'),
	instructions: arrayOfStrings(value.instructions, 'instructions')
});

const customMealFromArgs = (
	args: Record<string, unknown>
): CreateHouseholdMealInput['customMeal'] =>
	isRecord(args.customMeal)
		? {
				title: text(args.customMeal.title) ?? 'New meal',
				description: text(args.customMeal.description),
				imageUrl: text(args.customMeal.imageUrl),
				cookTimeMinutes: optionalNumber(
					args.customMeal.cookTimeMinutes,
					'customMeal.cookTimeMinutes'
				),
				ingredients: arrayOfStrings(args.customMeal.ingredients, 'customMeal.ingredients'),
				instructions: arrayOfStrings(args.customMeal.instructions, 'customMeal.instructions')
			}
		: undefined;

const createMealFromArgs = (
	householdId: string,
	workosUserId: string,
	args: Record<string, unknown>,
	userRecipeId = text(args.userRecipeId)
): CreateHouseholdMealInput => ({
	householdId,
	workosUserId,
	userRecipeId,
	date: text(args.date) ?? null,
	time: text(args.time) ?? null,
	sortOrder: optionalNumber(args.sortOrder, 'sortOrder') ?? null,
	plannedCookUserId: text(args.plannedCookUserId) ?? null,
	servingsPlanned: optionalNumber(args.servingsPlanned, 'servingsPlanned') ?? null,
	customMeal: userRecipeId ? undefined : customMealFromArgs(args)
});

export const createMealResolvingRecipe = async (
	context: McpContext,
	householdId: string,
	args: Record<string, unknown>
): Promise<CreateHouseholdMealInput> => {
	const url = text(args.url);
	const sources = [
		url,
		text(args.userRecipeId),
		isRecord(args.recipe),
		isRecord(args.customMeal)
	].filter(Boolean);
	if (sources.length !== 1) {
		throw toolError(
			'invalid_input',
			'Pass exactly one meal source: url, userRecipeId, recipe, or customMeal.'
		);
	}
	if (url) {
		const recipe = await createUserRecipe({
			db: context.db,
			workosUserId: context.key.userId,
			recipe: await fetchRecipeFromUrlForImport(url)
		});
		return createMealFromArgs(householdId, context.key.userId, args, recipe.id);
	}
	if (isRecord(args.recipe)) {
		const recipe = await createUserRecipe({
			db: context.db,
			workosUserId: context.key.userId,
			recipe: recipeFromArgs(args.recipe)
		});
		return createMealFromArgs(householdId, context.key.userId, args, recipe.id);
	}
	return createMealFromArgs(householdId, context.key.userId, args);
};

export const mealFailureLabel = (args: Record<string, unknown>, index: number): string =>
	text(args.title) ??
	(isRecord(args.customMeal) ? text(args.customMeal.title) : undefined) ??
	(isRecord(args.recipe) ? text(args.recipe.title) : undefined) ??
	text(args.url) ??
	text(args.userRecipeId) ??
	`Meal ${index + 1}`;

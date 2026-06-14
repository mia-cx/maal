import * as Schema from 'effect/Schema';
import { listUserHouseholds } from '$lib/server/auth/household';
import {
	listUserRecipes,
	getUserRecipe,
	createUserRecipe,
	updateUserRecipe,
	deleteUserRecipe
} from '$lib/server/domains/recipes';
import {
	createHouseholdMeal,
	deleteHouseholdMeal,
	getHouseholdMeal,
	listHouseholdPlanMeals,
	updateHouseholdMeal,
	upsertMealCheckIn
} from '$lib/server/domains/planning';
import { boundedPagination } from '$lib/shared/pagination';
import { arrayOfStrings, isRecord, optionalNumber, text } from './scalars';
import { toolError } from './results';
import { defaultPlanRange } from './plan-range';
import { requireScope, resolveHouseholdId, resolveScopedHouseholdId } from './context';
import {
	createRecipeShape,
	emptyInput,
	optionalHouseholdInput,
	recipeShape,
	recordInput,
	stringArray
} from './schemas';
import {
	createMealResolvingRecipe,
	mealFailureLabel,
	mealPatchFromArgs,
	recipeFromArgs,
	recipePatchFromArgs
} from './meal-input';
import type { ToolDefinition } from './registry';

const defaultRecipeLimit = 25;
const maxRecipeLimit = 60;
const defaultPlanLimit = 50;
const maxPlanLimit = 100;

export const tools: ToolDefinition[] = [
	{
		name: 'list_user_households',
		description:
			'List households this MCP key can access. Call this first when a tool asks for householdId or when the user mentions a specific household. If only one household is returned, other tools can usually omit householdId.',
		inputSchema: emptyInput,
		annotations: { readOnlyHint: true },
		handler: async (context) => {
			requireScope(context.key, 'households:read');
			const households = await listUserHouseholds(context.platform, context.key.userId);
			return { households };
		}
	},
	{
		name: 'list_user_recipes',
		description:
			'Search or page through the key owner’s saved recipes. Use query for title/source matching, limit/offset for pagination, and includeArchived only when the user asks for archived recipes. Defaults to 25 results and caps at 60.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			query: Schema.optional(Schema.String),
			limit: Schema.optional(Schema.Number),
			offset: Schema.optional(Schema.Number),
			includeArchived: Schema.optional(Schema.Boolean)
		}),
		annotations: { readOnlyHint: true },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'recipes:read', 'recipes:read');
			const { offset, limit } = boundedPagination(args, defaultRecipeLimit, maxRecipeLimit);
			const recipes = await listUserRecipes({
				db: context.db,
				workosUserId: context.key.userId,
				householdId,
				query: text(args.query),
				limit,
				offset,
				includeArchived: args.includeArchived === true
			});
			return {
				limit,
				offset,
				nextOffset: recipes.length === limit ? offset + limit : null,
				recipes
			};
		}
	},
	{
		name: 'get_user_recipe',
		description:
			'Fetch one saved recipe by recipeId, including ingredients, instructions, source metadata, times, and yield. Use after list_user_recipes when you need full details before editing or planning.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, recipeId: Schema.String }),
		annotations: { readOnlyHint: true },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'recipes:read', 'recipes:read');
			return {
				recipe: await getUserRecipe({
					db: context.db,
					workosUserId: context.key.userId,
					householdId,
					recipeId: text(args.recipeId) ?? ''
				})
			};
		}
	},
	{
		name: 'create_user_recipe',
		description:
			'Create a saved recipe in the key owner’s menu from structured recipe fields. Use when the user gives a recipe directly; for adding meals from URLs, prefer create_household_meal(s) with url so the meal is planned too.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			recipe: createRecipeShape
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			await resolveHouseholdId(context, args, 'recipes:write', 'recipes:write');
			if (!isRecord(args.recipe) || !text(args.recipe.title))
				throw toolError('invalid_input', 'Recipe title is required.');
			return {
				recipe: await createUserRecipe({
					db: context.db,
					workosUserId: context.key.userId,
					recipe: recipeFromArgs(args.recipe)
				})
			};
		}
	},
	{
		name: 'update_user_recipe',
		description:
			'Patch a saved recipe by recipeId. Omitted fields stay unchanged. Linked planned meals update only if their copied recipe content still matches the old recipe, so ad-hoc meal overrides are preserved.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			recipeId: Schema.String,
			patch: recipeShape
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			await resolveHouseholdId(context, args, 'recipes:write', 'recipes:write');
			if (!isRecord(args.patch)) throw toolError('invalid_input', 'Recipe patch is required.');
			return {
				recipe: await updateUserRecipe({
					db: context.db,
					workosUserId: context.key.userId,
					recipeId: text(args.recipeId) ?? '',
					patch: recipePatchFromArgs(args.patch)
				})
			};
		}
	},
	{
		name: 'delete_user_recipe',
		description:
			'Archive a saved recipe by recipeId. Use only when the user clearly wants the recipe removed from their menu; this is reversible in app data but should be treated as destructive.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, recipeId: Schema.String }),
		annotations: { readOnlyHint: false, destructiveHint: true },
		handler: async (context, args) => {
			await resolveHouseholdId(context, args, 'recipes:write', 'recipes:write');
			return await deleteUserRecipe({
				db: context.db,
				workosUserId: context.key.userId,
				recipeId: text(args.recipeId) ?? ''
			});
		}
	},
	{
		name: 'list_household_plan',
		description:
			'List planned meals for a household date range, plus floating meals unless includeFloating=false. Defaults to today through 14 days out, clamps ranges to 62 days, and supports limit/offset pagination capped at 100.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			startDate: Schema.optional(Schema.String),
			endDate: Schema.optional(Schema.String),
			includeFloating: Schema.optional(Schema.Boolean),
			limit: Schema.optional(Schema.Number),
			offset: Schema.optional(Schema.Number)
		}),
		annotations: { readOnlyHint: true },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'meals:read', 'meals:read');
			const { startDate, endDate } = defaultPlanRange(args);
			const { offset, limit } = boundedPagination(args, defaultPlanLimit, maxPlanLimit);
			const meals = await listHouseholdPlanMeals({
				platform: context.platform,
				db: context.db,
				workosUserId: context.key.userId,
				householdId,
				startDate,
				endDate,
				includeFloating: args.includeFloating !== false
			});
			return {
				startDate,
				endDate,
				limit,
				offset,
				nextOffset: meals.length > offset + limit ? offset + limit : null,
				meals: meals.slice(offset, offset + limit)
			};
		}
	},
	{
		name: 'create_household_meal',
		description:
			'Plan one household meal. Use userRecipeId for an existing saved recipe, url to import a JSON-LD recipe from a web page, recipe for a fully specified recipe object, or customMeal for an ad-hoc meal. Omit date for a floating meal.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			userRecipeId: Schema.optional(Schema.String),
			url: Schema.optional(Schema.String),
			recipe: Schema.optional(recordInput),
			date: Schema.optional(Schema.String),
			time: Schema.optional(Schema.String),
			plannedCookUserId: Schema.optional(Schema.String),
			servingsPlanned: Schema.optional(Schema.Number),
			customMeal: Schema.optional(recordInput)
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'meals:write', 'meals:write');
			return {
				meal: await createHouseholdMeal({
					platform: context.platform,
					db: context.db,
					meal: await createMealResolvingRecipe(context, householdId, args)
				})
			};
		}
	},
	{
		name: 'create_household_meals',
		description:
			'Plan up to 50 household meals in one call. Each item accepts userRecipeId, url, recipe, or customMeal. Valid meals are created even when other items fail; errors identify the item index, meal label, URL, and import/create reason so you can retry only failures.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			meals: Schema.Array(recordInput)
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'meals:write', 'meals:write');
			const meals = Array.isArray(args.meals) ? args.meals.filter(isRecord).slice(0, 50) : [];
			if (!meals.length) throw toolError('invalid_input', 'Pass between 1 and 50 meals.');
			const created = [];
			const errors = [];
			for (const [index, mealArgs] of meals.entries()) {
				try {
					created.push(
						await createHouseholdMeal({
							platform: context.platform,
							db: context.db,
							meal: await createMealResolvingRecipe(context, householdId, mealArgs)
						})
					);
				} catch (cause) {
					errors.push({
						index,
						meal: mealFailureLabel(mealArgs, index),
						url: text(mealArgs.url),
						code: text(mealArgs.url) ? 'import_or_create_failed' : 'create_failed',
						message: cause instanceof Error ? cause.message : 'Could not create meal.'
					});
				}
			}
			return { created, errors };
		}
	},
	{
		name: 'get_household_meal',
		description:
			'Fetch one planned or floating meal by mealId, including copied recipe details and schedule fields. Use before editing when you need the current meal-specific state.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, mealId: Schema.String }),
		annotations: { readOnlyHint: true },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'meals:read', 'meals:read');
			return {
				meal: await getHouseholdMeal({
					db: context.db,
					workosUserId: context.key.userId,
					householdId,
					mealId: text(args.mealId) ?? ''
				})
			};
		}
	},
	{
		name: 'update_household_meal',
		description:
			'Patch one planned or floating meal by mealId. Use for date/time changes, cook assignment, servings, status, or ad-hoc meal text. Omitted fields stay unchanged; set date/time to null to make the meal floating or unscheduled.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			mealId: Schema.String,
			patch: recordInput
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'meals:write', 'meals:write');
			if (!isRecord(args.patch)) throw toolError('invalid_input', 'Meal patch is required.');
			return {
				meal: await updateHouseholdMeal({
					platform: context.platform,
					db: context.db,
					meal: {
						householdId,
						workosUserId: context.key.userId,
						mealId: text(args.mealId) ?? '',
						patch: mealPatchFromArgs(args.patch)
					}
				})
			};
		}
	},
	{
		name: 'delete_household_meal',
		description:
			'Delete one planned or floating household meal by mealId. Use only when the user clearly wants that meal removed from the plan.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, mealId: Schema.String }),
		annotations: { readOnlyHint: false, destructiveHint: true },
		handler: async (context, args) => {
			const householdId = await resolveHouseholdId(context, args, 'meals:write', 'meals:write');
			return {
				deleted: await deleteHouseholdMeal({
					db: context.db,
					householdId,
					mealId: text(args.mealId) ?? ''
				})
			};
		}
	},
	{
		name: 'create_meal_check_in',
		description:
			'Create or update the key owner’s personal check-in for a meal. Use after a meal is cooked or skipped to record repeat/neutral/avoid feedback, optional reason, cooked status, and cookTime when the key owner was the planned cook.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			mealId: Schema.String,
			verdict: Schema.Literals(['repeat', 'neutral', 'avoid']),
			cooked: Schema.optional(Schema.Boolean),
			cookTime: Schema.optional(Schema.Number),
			reason: Schema.optional(Schema.String)
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			const householdId = await resolveScopedHouseholdId(context, args, 'check_ins:write');
			return await upsertMealCheckIn({
				db: context.db,
				workosUserId: context.key.userId,
				householdId,
				mealId: text(args.mealId) ?? '',
				verdict:
					args.verdict === 'repeat' || args.verdict === 'neutral' || args.verdict === 'avoid'
						? args.verdict
						: 'neutral',
				cooked: args.cooked !== false,
				cookTime: args.cookTime,
				reason: text(args.reason)
			});
		}
	}
];

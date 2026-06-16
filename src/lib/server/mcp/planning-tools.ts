import * as Schema from 'effect/Schema';
import { boundedPagination } from '$lib/shared/pagination';
import {
	createHouseholdMeal,
	deleteHouseholdMeal,
	getHouseholdMeal,
	listHouseholdPlanMeals,
	updateHouseholdMeal,
	upsertMealCheckIn
} from '$lib/server/domains/planning';
import { isRecord, text } from './scalars';
import { toolError } from './results';
import { defaultPlanRange } from './plan-range';
import { resolveHouseholdId, resolveScopedHouseholdId } from './context';
import { optionalHouseholdInput, recordInput } from './schemas';
import { createMealResolvingRecipe, mealPatchFromArgs } from './meal-input';
import { createBatchHouseholdMeals } from './batch-meal-handler';
import type { ToolDefinition } from './registry';

const defaultPlanLimit = 50;
const maxPlanLimit = 100;

export const planningTools: ToolDefinition[] = [
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
			return createBatchHouseholdMeals(context, householdId, args);
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

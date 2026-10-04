import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	allMealConflictGroups,
	allRecipeConflictGroups,
	cloneRecipeAsMeal,
	createRecipeAggregate,
	propagateRecipeUpdateToLinkedMeals,
	type RemoteDomainPort
} from '$lib/server/domain/remote-port.js';
import {
	authorizeMcpRecipeImport,
	consumeRecipeImportLimit
} from '$lib/server/recipe-import/remote-compute.js';

import {
	candidateFromToolRecipe,
	customMealFromArgs,
	isRecord,
	makeCheckIn,
	optionalNumber,
	patchMeal,
	patchRecipe,
	requiredText,
	text
} from './builders.js';
import type { McpContext } from './context.js';
import {
	requireScope,
	resolveHousehold,
	resolveUserDataProof,
	resolveUserRecipeProof
} from './context.js';
import { toolError } from './results.js';
import {
	createRecipeShape,
	emptyInput,
	optionalHouseholdInput,
	recipeShape,
	recordInput,
	type ToolInputSchema
} from './schemas.js';

export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: ToolInputSchema;
	readonly annotations?: ToolAnnotations;
	readonly handler: (context: McpContext, args: Record<string, unknown>) => Promise<unknown>;
}

const boundedInt = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
	typeof value === 'number' && Number.isFinite(value)
		? Math.min(maximum, Math.max(minimum, Math.trunc(value)))
		: fallback;

const requireRecipe = async (domain: RemoteDomainPort, ownerUserId: string, recipeId: string) => {
	const recipe = await domain.getUserRecipe(ownerUserId, recipeId);
	if (!recipe || recipe.deletedAt !== null) throw toolError('not_found', 'Recipe not found.');
	return recipe;
};

const requireMeal = async (domain: RemoteDomainPort, householdId: string, mealId: string) => {
	const meal = await domain.getHouseholdMeal(householdId, mealId);
	if (!meal || meal.deletedAt !== null) throw toolError('not_found', 'Meal not found.');
	return meal;
};

const dateRange = (args: Record<string, unknown>): { startDate: string; endDate: string } => {
	const today = new Date().toISOString().slice(0, 10);
	const startDate = text(args.startDate) ?? today;
	const parsedStart = new Date(`${startDate}T00:00:00.000Z`);
	if (Number.isNaN(parsedStart.getTime()) || parsedStart.toISOString().slice(0, 10) !== startDate) {
		throw toolError('invalid_input', 'startDate must be a valid YYYY-MM-DD date.');
	}
	const defaultEnd = new Date(parsedStart.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
	const requestedEnd = text(args.endDate) ?? defaultEnd;
	const parsedEnd = new Date(`${requestedEnd}T00:00:00.000Z`);
	if (Number.isNaN(parsedEnd.getTime()) || parsedEnd.toISOString().slice(0, 10) !== requestedEnd) {
		throw toolError('invalid_input', 'endDate must be a valid YYYY-MM-DD date.');
	}
	if (parsedEnd < parsedStart)
		throw toolError('invalid_input', 'endDate must not precede startDate.');
	const maxEnd = new Date(parsedStart.getTime() + 62 * 86_400_000);
	return {
		startDate,
		endDate: (parsedEnd > maxEnd ? maxEnd : parsedEnd).toISOString().slice(0, 10)
	};
};

const createMeal = async (
	context: McpContext,
	householdId: string,
	args: Record<string, unknown>
) => {
	const url = text(args.url);
	const userRecipeId = text(args.userRecipeId);
	const recipeInput = isRecord(args.recipe) ? args.recipe : null;
	const customMeal = isRecord(args.customMeal) ? args.customMeal : null;
	if ([url, userRecipeId, recipeInput, customMeal].filter(Boolean).length !== 1) {
		throw toolError(
			'invalid_input',
			'Pass exactly one meal source: url, userRecipeId, recipe, or customMeal.'
		);
	}
	const date = text(args.date);
	const time = text(args.time);
	const plannedCookUserId = text(args.plannedCookUserId);
	const plannedYield = optionalNumber(args.servingsPlanned, 'servingsPlanned') ?? null;
	let meal;
	if (customMeal) {
		meal = customMealFromArgs({
			householdId,
			actorUserId: context.principal.ownerUserId,
			custom: customMeal,
			date,
			time,
			plannedCookUserId,
			plannedYield
		});
	} else {
		let recipe;
		if (url) {
			authorizeMcpRecipeImport(context.principal, householdId);
			await consumeRecipeImportLimit({
				limiter: context.limiter,
				workosUserId: context.principal.ownerUserId,
				householdId,
				mcpKeyId: context.principal.keyId
			});
			recipe = createRecipeAggregate({
				ownerUserId: context.principal.ownerUserId,
				candidate: await context.fetchRecipeCandidate(url)
			});
			recipe = await context.domain.writeUserRecipe({
				actorUserId: context.principal.ownerUserId,
				aggregate: recipe,
				conflictGroups: allRecipeConflictGroups,
				operation: 'upsert'
			});
		} else if (recipeInput) {
			recipe = createRecipeAggregate({
				ownerUserId: context.principal.ownerUserId,
				candidate: candidateFromToolRecipe(recipeInput)
			});
			recipe = await context.domain.writeUserRecipe({
				actorUserId: context.principal.ownerUserId,
				aggregate: recipe,
				conflictGroups: allRecipeConflictGroups,
				operation: 'upsert'
			});
		} else {
			recipe = await requireRecipe(context.domain, context.principal.ownerUserId, userRecipeId!);
		}
		meal = cloneRecipeAsMeal({
			recipe,
			householdId,
			date,
			time,
			plannedCookUserId,
			plannedYield
		});
	}
	return context.domain.writeHouseholdMeal({
		actorUserId: context.principal.ownerUserId,
		householdId,
		aggregate: meal,
		conflictGroups: allMealConflictGroups,
		operation: 'upsert'
	});
};

export const tools: readonly ToolDefinition[] = [
	{
		name: 'list_user_households',
		description:
			'List households this MCP key can access. Call this first when a tool asks for householdId or when the user mentions a specific household. If only one household is returned, other tools can usually omit householdId.',
		inputSchema: emptyInput,
		annotations: { readOnlyHint: true },
		handler: async (context) => {
			requireScope(context.principal, 'households:read');
			const readable = context.principal.effectiveHouseholds;
			const ids = readable.map(({ householdId }) => householdId);
			const names = new Map(
				readable.map(({ householdId, householdName }) => [householdId, householdName])
			);
			return {
				households: (await context.domain.listHouseholds(ids)).map((household) => ({
					...household,
					name: names.get(household.id) ?? household.name
				}))
			};
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
			resolveUserRecipeProof(context, args, 'recipes:read');
			const offset = boundedInt(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
			const limit = boundedInt(args.limit, 25, 1, 60);
			const query = text(args.query)?.toLocaleLowerCase();
			const recipes = (await context.domain.listUserRecipes(context.principal.ownerUserId)).filter(
				(recipe) =>
					(args.includeArchived === true || recipe.deletedAt === null) &&
					(!query ||
						recipe.title.toLocaleLowerCase().includes(query) ||
						recipe.sourceSiteName?.toLocaleLowerCase().includes(query))
			);
			return {
				limit,
				offset,
				nextOffset: recipes.length > offset + limit ? offset + limit : null,
				recipes: recipes.slice(offset, offset + limit)
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
			resolveUserRecipeProof(context, args, 'recipes:read');
			return {
				recipe: await requireRecipe(
					context.domain,
					context.principal.ownerUserId,
					requiredText(args.recipeId, 'recipeId')
				)
			};
		}
	},
	{
		name: 'create_user_recipe',
		description:
			'Create a saved recipe in the key owner’s menu from structured recipe fields. Use when the user gives a recipe directly; for adding meals from URLs, prefer create_household_meal(s) with url so the meal is planned too.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, recipe: createRecipeShape }),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			resolveUserRecipeProof(context, args, 'recipes:write');
			if (!isRecord(args.recipe)) throw toolError('invalid_input', 'Recipe is required.');
			const aggregate = createRecipeAggregate({
				ownerUserId: context.principal.ownerUserId,
				candidate: candidateFromToolRecipe(args.recipe)
			});
			return {
				recipe: await context.domain.writeUserRecipe({
					actorUserId: context.principal.ownerUserId,
					aggregate,
					conflictGroups: allRecipeConflictGroups,
					operation: 'upsert'
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
			resolveUserRecipeProof(context, args, 'recipes:write');
			if (!isRecord(args.patch)) throw toolError('invalid_input', 'Recipe patch is required.');
			const current = await requireRecipe(
				context.domain,
				context.principal.ownerUserId,
				requiredText(args.recipeId, 'recipeId')
			);
			const recipe = await context.domain.writeUserRecipe({
				actorUserId: context.principal.ownerUserId,
				aggregate: patchRecipe(current, args.patch),
				conflictGroups: ['header', 'ingredients', 'instructions'],
				operation: 'upsert'
			});
			await propagateRecipeUpdateToLinkedMeals({
				domain: context.domain,
				actorUserId: context.principal.ownerUserId,
				householdIds: context.principal.scopes.includes('meals:write')
					? context.principal.effectiveHouseholds
							.filter(({ permissions }) => permissions.includes('meals:write'))
							.map(({ householdId }) => householdId)
					: [],
				previous: current,
				next: recipe
			});
			return { recipe };
		}
	},
	{
		name: 'delete_user_recipe',
		description:
			'Archive a saved recipe by recipeId. Use only when the user clearly wants the recipe removed from their menu; this is reversible in app data but should be treated as destructive.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, recipeId: Schema.String }),
		annotations: { readOnlyHint: false, destructiveHint: true },
		handler: async (context, args) => {
			resolveUserRecipeProof(context, args, 'recipes:write');
			const recipe = await requireRecipe(
				context.domain,
				context.principal.ownerUserId,
				requiredText(args.recipeId, 'recipeId')
			);
			const deletedAt = new Date().toISOString() as `${string}Z`;
			await context.domain.writeUserRecipe({
				actorUserId: context.principal.ownerUserId,
				aggregate: { ...recipe, deletedAt, updatedAt: deletedAt },
				conflictGroups: ['deletion'],
				operation: 'delete'
			});
			return { deleted: true, recipeId: recipe.id };
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
			const household = resolveHousehold(context, args, 'meals:read', 'meals:read');
			const range = dateRange(args);
			const offset = boundedInt(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
			const limit = boundedInt(args.limit, 50, 1, 100);
			const meals = (await context.domain.listHouseholdMeals(household.householdId))
				.filter(
					(meal) =>
						meal.deletedAt === null &&
						(meal.date === null
							? args.includeFloating !== false
							: meal.date >= range.startDate && meal.date <= range.endDate)
				)
				.toSorted((left, right) =>
					`${left.date ?? ''}\u0000${left.time ?? ''}\u0000${left.sortOrder ?? 0}`.localeCompare(
						`${right.date ?? ''}\u0000${right.time ?? ''}\u0000${right.sortOrder ?? 0}`
					)
				);
			return {
				...range,
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
			const household = resolveHousehold(context, args, 'meals:write', 'meals:write');
			return { meal: await createMeal(context, household.householdId, args) };
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
			const household = resolveHousehold(context, args, 'meals:write', 'meals:write');
			if (!Array.isArray(args.meals) || args.meals.length < 1 || args.meals.length > 50) {
				throw toolError('invalid_input', 'Pass between 1 and 50 meals.');
			}
			const created = [];
			const errors = [];
			for (const [index, value] of args.meals.entries()) {
				if (!isRecord(value)) {
					errors.push({ index, code: 'invalid_input', message: 'Meal must be an object.' });
					continue;
				}
				try {
					created.push(await createMeal(context, household.householdId, value));
				} catch (cause) {
					errors.push({
						index,
						meal: text(value.url) ?? text(value.userRecipeId) ?? `Meal ${index + 1}`,
						url: text(value.url),
						code: text(value.url) ? 'import_or_create_failed' : 'create_failed',
						message: cause instanceof Error ? cause.message : 'Could not create this meal.'
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
			const household = resolveHousehold(context, args, 'meals:read', 'meals:read');
			return {
				meal: await requireMeal(
					context.domain,
					household.householdId,
					requiredText(args.mealId, 'mealId')
				)
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
			const household = resolveHousehold(context, args, 'meals:write', 'meals:write');
			if (!isRecord(args.patch)) throw toolError('invalid_input', 'Meal patch is required.');
			const meal = await requireMeal(
				context.domain,
				household.householdId,
				requiredText(args.mealId, 'mealId')
			);
			return {
				meal: await context.domain.writeHouseholdMeal({
					actorUserId: context.principal.ownerUserId,
					householdId: household.householdId,
					aggregate: patchMeal(meal, args.patch),
					conflictGroups: ['header', 'schedule', 'status'],
					operation: 'upsert'
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
			const household = resolveHousehold(context, args, 'meals:write', 'meals:write');
			const meal = await requireMeal(
				context.domain,
				household.householdId,
				requiredText(args.mealId, 'mealId')
			);
			const deletedAt = new Date().toISOString() as `${string}Z`;
			await context.domain.writeHouseholdMeal({
				actorUserId: context.principal.ownerUserId,
				householdId: household.householdId,
				aggregate: { ...meal, deletedAt, updatedAt: deletedAt },
				conflictGroups: ['deletion'],
				operation: 'delete'
			});
			return { deleted: true, mealId: meal.id };
		}
	},
	{
		name: 'create_meal_check_in',
		description:
			'Create or update the key owner’s personal check-in for a meal. Use after a meal is cooked or skipped to record repeat/neutral/avoid feedback, optional reason, cooked status, and cookTime when the key owner was the planned cook.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			mealId: Schema.String,
			verdict: Schema.Literal('repeat', 'neutral', 'avoid'),
			cooked: Schema.optional(Schema.Boolean),
			cookTime: Schema.optional(Schema.Number),
			cookTimeMinutes: Schema.optional(Schema.Number),
			reason: Schema.optional(Schema.String)
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			const household = resolveHousehold(context, args, 'check_ins:write', 'meals:write');
			const mealId = requiredText(args.mealId, 'mealId');
			const meal = await requireMeal(context.domain, household.householdId, mealId);
			const existing = await context.domain.getMealCheckIn(
				household.householdId,
				mealId,
				context.principal.ownerUserId
			);
			const rawCookTime = args.cookTimeMinutes ?? args.cookTime;
			const cookTime = optionalNumber(rawCookTime, 'cookTimeMinutes') ?? null;
			const checkIn = await context.domain.writeMealCheckIn({
				actorUserId: context.principal.ownerUserId,
				householdId: household.householdId,
				aggregate: makeCheckIn({
					existing,
					mealId,
					reporterUserId: context.principal.ownerUserId,
					verdict: args.verdict === 'repeat' || args.verdict === 'avoid' ? args.verdict : 'neutral',
					cookTimeMinutes: cookTime === null ? null : Math.max(1, Math.round(cookTime)),
					reason: text(args.reason)
				})
			});
			const status = args.cooked === false ? 'skipped' : 'cooked';
			const updatedMeal = await context.domain.writeHouseholdMeal({
				actorUserId: context.principal.ownerUserId,
				householdId: household.householdId,
				aggregate: { ...meal, status },
				conflictGroups: ['status'],
				operation: 'upsert'
			});
			return { checkIn, meal: updatedMeal };
		}
	},
	{
		name: 'list_meal_check_ins',
		description:
			'List active household meal check-ins, optionally narrowed to one meal. Returns each household member’s focused repeat verdict, cook time, and notes.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			mealId: Schema.optional(Schema.String)
		}),
		annotations: { readOnlyHint: true },
		handler: async (context, args) => {
			const household = resolveHousehold(context, args, 'check_ins:read', 'meals:read');
			const mealId = text(args.mealId);
			return {
				checkIns: await context.domain.listMealCheckIns(
					household.householdId,
					...(mealId ? [mealId] : [])
				)
			};
		}
	},
	{
		name: 'get_food_profile',
		description:
			'Read the key owner’s active food preferences, custom foods and units, aliases, and display overrides. User-owned profile data is available through any granted paid household.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput }),
		annotations: { readOnlyHint: true },
		handler: async (context, args) => {
			resolveUserDataProof(context, args, 'food_profile:read', 'recipes:read');
			return { profile: await context.domain.getUserFoodProfile(context.principal.ownerUserId) };
		}
	},
	{
		name: 'set_food_preference',
		description:
			'Create or update the key owner’s preference for one canonical or custom food. Use favourite, like, dislike, or disallowed and optionally record a short reason.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			foodId: Schema.String,
			preference: Schema.Literal('favourite', 'like', 'dislike', 'disallowed'),
			reason: Schema.optional(Schema.NullOr(Schema.String))
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			resolveUserDataProof(context, args, 'food_profile:write', 'recipes:write');
			const foodId = requiredText(args.foodId, 'foodId');
			const profile = await context.domain.getUserFoodProfile(context.principal.ownerUserId);
			const existing = profile.userFoodPreferences.find((row) => row.foodId === foodId);
			const now = new Date().toISOString() as `${string}Z`;
			const preference = await context.domain.writeUserFoodPreference({
				actorUserId: context.principal.ownerUserId,
				aggregate: {
					id: existing?.id ?? uuidv7(),
					workosUserId: context.principal.ownerUserId,
					foodId,
					preference:
						args.preference === 'favourite' ||
						args.preference === 'dislike' ||
						args.preference === 'disallowed'
							? args.preference
							: 'like',
					reason: args.reason === null ? null : text(args.reason),
					schemaVersion: 1,
					revision: existing?.revision ?? 0,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
					deletedAt: null,
					conflictClocks: existing?.conflictClocks ?? {}
				}
			});
			return { preference };
		}
	},
	{
		name: 'create_household_invite',
		description:
			'Create a Maal invite code for a household member or child. The returned plaintext code is shown once; share it with the intended person.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			roleSlug: Schema.Literal('member', 'child'),
			expiresInDays: Schema.Literal(1, 7, 30),
			maxUses: Schema.optional(Schema.NullOr(Schema.Number))
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			const household = resolveHousehold(context, args, 'households:write', 'households:write');
			const maxUses = args.maxUses === null ? null : boundedInt(args.maxUses, 1, 1, 100);
			return context.administration.createInvite({
				householdId: household.householdId,
				roleSlug: args.roleSlug === 'child' ? 'child' : 'member',
				expiresInDays:
					args.expiresInDays === 1 || args.expiresInDays === 30 ? args.expiresInDays : 7,
				maxUses
			});
		}
	},
	{
		name: 'revoke_household_invite',
		description: 'Revoke an unused or partially used Maal household invite immediately.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, inviteId: Schema.String }),
		annotations: { readOnlyHint: false, destructiveHint: true },
		handler: async (context, args) => {
			const household = resolveHousehold(context, args, 'households:write', 'households:write');
			return {
				invite: await context.administration.revokeInvite(
					household.householdId,
					requiredText(args.inviteId, 'inviteId')
				)
			};
		}
	},
	{
		name: 'update_household_member_role',
		description:
			'Change a household member between admin, member, and child. Billing-owner and last-admin protections still apply.',
		inputSchema: Schema.Struct({
			...optionalHouseholdInput,
			membershipId: Schema.String,
			roleSlug: Schema.Literal('admin', 'member', 'child')
		}),
		annotations: { readOnlyHint: false },
		handler: async (context, args) => {
			const household = resolveHousehold(context, args, 'households:write', 'households:write');
			return {
				membership: await context.administration.updateMemberRole(
					household.householdId,
					requiredText(args.membershipId, 'membershipId'),
					args.roleSlug === 'admin' || args.roleSlug === 'child' ? args.roleSlug : 'member'
				)
			};
		}
	},
	{
		name: 'remove_household_member',
		description:
			'Remove a household member. Current billing-owner, last-admin, and directory-managed protections still apply.',
		inputSchema: Schema.Struct({ ...optionalHouseholdInput, membershipId: Schema.String }),
		annotations: { readOnlyHint: false, destructiveHint: true },
		handler: async (context, args) => {
			const household = resolveHousehold(context, args, 'households:write', 'households:write');
			const membershipId = requiredText(args.membershipId, 'membershipId');
			await context.administration.removeMember(household.householdId, membershipId);
			return { householdId: household.householdId, membershipId, removed: true };
		}
	}
];

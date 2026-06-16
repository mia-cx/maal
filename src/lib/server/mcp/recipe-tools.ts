import * as Schema from 'effect/Schema';
import {
	createUserRecipe,
	deleteUserRecipe,
	getUserRecipe,
	listUserRecipes,
	updateUserRecipe
} from '$lib/server/domains/recipes';
import { boundedPagination } from '$lib/shared/pagination';
import { isRecord, requireNonEmptyText, text } from './scalars';
import { toolError } from './results';
import { resolveHouseholdId } from './context';
import { createRecipeShape, optionalHouseholdInput, recipeShape } from './schemas';
import { recipeFromArgs, recipePatchFromArgs } from './meal-input';
import type { ToolDefinition } from './registry';

const defaultRecipeLimit = 25;
const maxRecipeLimit = 60;

export const recipeTools: ToolDefinition[] = [
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
					recipeId: requireNonEmptyText(args.recipeId, 'recipeId')
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
					recipeId: requireNonEmptyText(args.recipeId, 'recipeId'),
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
				recipeId: requireNonEmptyText(args.recipeId, 'recipeId')
			});
		}
	}
];

import type { RequestHandler } from '@sveltejs/kit';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool,
	type ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js';
import * as Schema from 'effect/Schema';
import { getDb } from '$lib/server/db';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';
import { listUserHouseholds } from '$lib/server/auth/household';
import { verifyMcpKey } from '$lib/server/auth/mcp-keys';
import {
	listUserRecipes,
	getUserRecipe,
	createUserRecipe,
	updateUserRecipe,
	deleteUserRecipe,
	fetchRecipeFromUrlForImport
} from '$lib/server/domains/recipes';
import {
	createHouseholdMeal,
	deleteHouseholdMeal,
	getHouseholdMeal,
	listHouseholdPlanMeals,
	updateHouseholdMeal,
	upsertMealCheckIn,
	type CreateHouseholdMealInput,
	type UpdateHouseholdMealInput
} from '$lib/server/domains/planning';
import { boundedPagination } from '$lib/shared/pagination';
import { arrayOfStrings, isRecord, optionalNumber, text } from '$lib/server/mcp/scalars';
import { toolError, toolResult } from '$lib/server/mcp/results';
import { defaultPlanRange } from '$lib/server/mcp/plan-range';
import {
	requireScope,
	resolveHouseholdId,
	resolveScopedHouseholdId,
	type McpContext
} from '$lib/server/mcp/context';

type ToolHandler = (context: McpContext, args: Record<string, unknown>) => Promise<unknown>;
type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: InputSchema;
	annotations?: ToolAnnotations;
	handler: ToolHandler;
};

const defaultRecipeLimit = 25;
const maxRecipeLimit = 60;
const defaultPlanLimit = 50;
const maxPlanLimit = 100;

type InputSchema = Schema.Decoder<unknown>;

const optionalHouseholdInput = { householdId: Schema.optional(Schema.String) };
const stringArray = Schema.Array(Schema.String);
const recordInput = Schema.Record(Schema.String, Schema.Unknown);
const recipeFields = {
	title: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	image: Schema.optional(Schema.String),
	sourceUrl: Schema.optional(Schema.String),
	sourceSiteName: Schema.optional(Schema.String),
	sourceAuthorName: Schema.optional(Schema.String),
	sourcePublisherName: Schema.optional(Schema.String),
	sourceIsBasedOnUrl: Schema.optional(Schema.String),
	prepTimeMinutes: Schema.optional(Schema.Number),
	cookTimeMinutes: Schema.optional(Schema.Number),
	yield: Schema.optional(Schema.Number),
	ingredients: Schema.optional(stringArray),
	instructions: Schema.optional(stringArray),
	userNotes: Schema.optional(Schema.String)
};
const recipeShape = Schema.Struct(recipeFields);
const emptyInput = Schema.Struct({});

const recipeFromArgs = (
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
	prepTimeMinutes: optionalNumber(value.prepTimeMinutes),
	cookTimeMinutes: optionalNumber(value.cookTimeMinutes),
	yield: optionalNumber(value.yield),
	ingredients: (arrayOfStrings(value.ingredients) ?? []).map((line) => ({
		amount: '',
		item: line
	})),
	instructions: (arrayOfStrings(value.instructions) ?? []).map((line, index) => ({
		position: index,
		text: line
	})),
	userNotes: text(value.userNotes)
});

const recipePatchFromArgs = (value: Record<string, unknown>): Partial<RecipeMenuItem> => ({
	title: text(value.title),
	description: text(value.description),
	image: text(value.image),
	sourceUrl: text(value.sourceUrl),
	sourceSiteName: text(value.sourceSiteName),
	sourceAuthorName: text(value.sourceAuthorName),
	sourcePublisherName: text(value.sourcePublisherName),
	sourceIsBasedOnUrl: text(value.sourceIsBasedOnUrl),
	prepTimeMinutes: optionalNumber(value.prepTimeMinutes),
	cookTimeMinutes: optionalNumber(value.cookTimeMinutes),
	yield: optionalNumber(value.yield),
	ingredients: arrayOfStrings(value.ingredients)?.map((line) => ({
		amount: '',
		item: line
	})),
	instructions: arrayOfStrings(value.instructions)?.map((line, index) => ({
		position: index,
		text: line
	})),
	userNotes: text(value.userNotes)
});

const mealPatchFromArgs = (value: Record<string, unknown>): UpdateHouseholdMealInput['patch'] => ({
	date: value.date === null ? null : text(value.date),
	time: value.time === null ? null : text(value.time),
	sortOrder: value.sortOrder === null ? null : optionalNumber(value.sortOrder),
	plannedCookUserId: value.plannedCookUserId === null ? null : text(value.plannedCookUserId),
	servingsPlanned: optionalNumber(value.servingsPlanned),
	status:
		value.status === 'planned' || value.status === 'cooked' || value.status === 'skipped'
			? value.status
			: undefined,
	title: text(value.title),
	description: value.description === null ? null : text(value.description),
	cookTimeMinutes: value.cookTimeMinutes === null ? null : optionalNumber(value.cookTimeMinutes),
	ingredients: arrayOfStrings(value.ingredients),
	instructions: arrayOfStrings(value.instructions)
});

const customMealFromArgs = (
	args: Record<string, unknown>
): CreateHouseholdMealInput['customMeal'] =>
	isRecord(args.customMeal)
		? {
				title: text(args.customMeal.title) ?? 'New meal',
				description: text(args.customMeal.description),
				imageUrl: text(args.customMeal.imageUrl),
				cookTimeMinutes: optionalNumber(args.customMeal.cookTimeMinutes),
				ingredients: arrayOfStrings(args.customMeal.ingredients),
				instructions: arrayOfStrings(args.customMeal.instructions)
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
	sortOrder: optionalNumber(args.sortOrder) ?? null,
	plannedCookUserId: text(args.plannedCookUserId) ?? null,
	servingsPlanned: optionalNumber(args.servingsPlanned) ?? null,
	customMeal: userRecipeId ? undefined : customMealFromArgs(args)
});

const createMealResolvingRecipe = async (
	context: McpContext,
	householdId: string,
	args: Record<string, unknown>
): Promise<CreateHouseholdMealInput> => {
	const url = text(args.url);
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

const mealFailureLabel = (args: Record<string, unknown>, index: number): string =>
	text(args.title) ??
	(isRecord(args.customMeal) ? text(args.customMeal.title) : undefined) ??
	(isRecord(args.recipe) ? text(args.recipe.title) : undefined) ??
	text(args.url) ??
	text(args.userRecipeId) ??
	`Meal ${index + 1}`;

const tools: ToolDefinition[] = [
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
			recipe: Schema.Struct({ ...recipeFields, title: Schema.String })
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

const bearerToken = (request: Request): string | null => {
	const authorization = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(authorization);
	return match?.[1]?.trim() ?? null;
};

const mcpAuthDiscovery = {
	authentication: {
		type: 'bearer',
		scheme: 'Bearer',
		header: 'Authorization',
		format: 'Authorization: Bearer <Maal MCP key>',
		instructions: 'Create a Maal MCP key in Settings → MCP keys, then use it as a bearer token.'
	}
};

const bearerChallenge = 'Bearer realm="Maal MCP", error="invalid_token"';

const jsonResponse = (body: unknown, status: number, headers: HeadersInit = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

const authDiscoveryResponse = (request: Request) => {
	const body = JSON.stringify(mcpAuthDiscovery);
	if (request.headers.get('accept')?.includes('text/event-stream')) {
		return new Response(`event: auth\ndata: ${body}\n\n`, {
			status: 200,
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-store',
				connection: 'keep-alive'
			}
		});
	}
	return jsonResponse(mcpAuthDiscovery, 200, { 'cache-control': 'no-store' });
};

const unauthorizedResponse = (error: string) =>
	jsonResponse({ error, ...mcpAuthDiscovery }, 401, {
		'www-authenticate': bearerChallenge,
		'cache-control': 'no-store'
	});

const createContext = async (
	platform: App.Platform | undefined,
	request: Request
): Promise<McpContext | Response> => {
	if (!platform?.env.DB) return jsonResponse({ error: 'Database unavailable.' }, 503);
	const token = bearerToken(request);
	if (!token) return unauthorizedResponse('Missing bearer MCP key.');
	try {
		const key = await verifyMcpKey({ platform, rawKey: token });
		if (!key) return unauthorizedResponse('Invalid MCP key.');
		return { platform, key, db: getDb(platform.env.DB) };
	} catch {
		return jsonResponse({ error: 'MCP key storage unavailable.' }, 503);
	}
};

const schemaForToolList = (schema: InputSchema): Tool['inputSchema'] => {
	const jsonSchema = Schema.toJsonSchemaDocument(schema).schema as Record<string, unknown>;
	if (!jsonSchema.type) {
		return { type: 'object', properties: {}, additionalProperties: false };
	}
	return jsonSchema as Tool['inputSchema'];
};

const registerToolHandlers = (server: Server, context: McpContext) => {
	const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: schemaForToolList(tool.inputSchema),
			annotations: tool.annotations
		}))
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = toolMap.get(request.params.name);
		if (!tool) {
			return { isError: true, ...toolResult(toolError('unknown_tool', 'Unknown tool.')) };
		}
		try {
			const args = Schema.decodeUnknownSync(tool.inputSchema)(
				request.params.arguments ?? {}
			) as Record<string, unknown>;
			return toolResult(await tool.handler(context, args));
		} catch (cause) {
			const data =
				isRecord(cause) && typeof cause.code === 'string'
					? cause
					: toolError('tool_failed', cause instanceof Error ? cause.message : 'Tool failed.');
			return { isError: true, ...toolResult(data) };
		}
	});
};

const handleMcpRequest = async (platform: App.Platform | undefined, request: Request) => {
	const context = await createContext(platform, request);
	if (context instanceof Response) return context;

	const server = new Server({ name: 'maal', version: '0.1.0' }, { capabilities: { tools: {} } });
	registerToolHandlers(server, context);

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});

	await server.connect(transport);
	try {
		return await transport.handleRequest(request);
	} finally {
		await server.close();
	}
};

export const POST: RequestHandler = async ({ platform, request }) =>
	handleMcpRequest(platform, request);

export const GET: RequestHandler = async ({ platform, request }) =>
	bearerToken(request) ? handleMcpRequest(platform, request) : authDiscoveryResponse(request);

export const DELETE: RequestHandler = async ({ platform, request }) =>
	handleMcpRequest(platform, request);

export const OPTIONS: RequestHandler = async () => new Response(null, { status: 204 });

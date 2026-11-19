import { describe, expect, test, vi } from 'vitest';

import { copyRecipeIntoMeal } from '$lib/domain/meals/recipe-following.js';
import {
	MEAL_COPY_GROUPS,
	isRecipeFollowingMeal,
	type LiveMeal,
	type MealCheckIn
} from '$lib/domain/meals/schema.js';
import type { RecipeAggregate, RecipeImportedCandidate } from '$lib/domain/recipes/schema.js';
import type { UserFoodPreference } from '$lib/domain/taxonomy/schema.js';
import {
	createRecipeAggregate,
	followRecipeAsMeal,
	type RemoteDomainPort,
	type RemoteFoodProfile,
	type RemoteHouseholdSummary,
	type RemoteMeal
} from '$lib/server/domain/remote-port.js';
import { candidateFromToolRecipe, patchRecipe } from '$lib/server/mcp/builders.js';
import { MAAL_API_SCOPES, tools, type McpContext } from '$lib/server/mcp/index.js';

const householdId = 'org_family';
const ownerUserId = 'user_alice';
const existingRecipe = createRecipeAggregate({
	ownerUserId,
	candidate: candidateFromToolRecipe({
		title: 'Existing soup',
		ingredients: ['1 onion'],
		instructions: ['Simmer.']
	})
});
const existingMeal: RemoteMeal = {
	...copyRecipeIntoMeal(
		followRecipeAsMeal({ recipe: existingRecipe, householdId, date: '2026-08-23' }),
		existingRecipe
	),
	followsRecipe: true,
	recipeVersionId: '0198d3bc-e600-7000-8000-0000000000b1'
};

class SpyDomain implements RemoteDomainPort {
	readonly calls: string[] = [];
	recipe = existingRecipe;
	meal = existingMeal;
	checkIn: MealCheckIn | null = null;
	foodPreference: UserFoodPreference | null = null;

	async listHouseholds(): Promise<readonly RemoteHouseholdSummary[]> {
		this.calls.push('listHouseholds');
		return [{ id: householdId, name: 'Family', locale: 'en-US', timezone: null }];
	}
	async listUserRecipes(): Promise<readonly RecipeAggregate[]> {
		this.calls.push('listUserRecipes');
		return [this.recipe];
	}
	async getUserRecipe(): Promise<RecipeAggregate | null> {
		this.calls.push('getUserRecipe');
		return this.recipe;
	}
	async ensureRecipeVersion(): Promise<void> {
		this.calls.push('ensureRecipeVersion');
	}
	async writeUserRecipe(input: { aggregate: RecipeAggregate }): Promise<RecipeAggregate> {
		this.calls.push('writeUserRecipe');
		this.recipe = input.aggregate;
		return this.recipe;
	}
	async listHouseholdMeals(): Promise<readonly RemoteMeal[]> {
		this.calls.push('listHouseholdMeals');
		return [this.meal];
	}
	async getHouseholdMeal(): Promise<RemoteMeal | null> {
		this.calls.push('getHouseholdMeal');
		return this.meal;
	}
	readonly mealWrites: { aggregate: LiveMeal; conflictGroups: readonly string[] }[] = [];
	async writeHouseholdMeal(input: {
		aggregate: LiveMeal;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<RemoteMeal | null> {
		this.calls.push('writeHouseholdMeal');
		this.mealWrites.push(input);
		if (input.operation === 'delete') return null;
		this.meal = isRecipeFollowingMeal(input.aggregate)
			? {
					...copyRecipeIntoMeal(input.aggregate, this.recipe),
					followsRecipe: true,
					recipeVersionId: existingMeal.recipeVersionId
				}
			: { ...input.aggregate, followsRecipe: false, recipeVersionId: null };
		return this.meal;
	}
	async getMealCheckIn(): Promise<MealCheckIn | null> {
		this.calls.push('getMealCheckIn');
		return this.checkIn;
	}
	async writeMealCheckIn(input: { aggregate: MealCheckIn }): Promise<MealCheckIn> {
		this.calls.push('writeMealCheckIn');
		this.checkIn = input.aggregate;
		return input.aggregate;
	}
	async listMealCheckIns(): Promise<readonly MealCheckIn[]> {
		this.calls.push('listMealCheckIns');
		return this.checkIn ? [this.checkIn] : [];
	}
	async getUserFoodProfile(): Promise<RemoteFoodProfile> {
		this.calls.push('getUserFoodProfile');
		return {
			foodUserAliases: [],
			foodUserEntries: [],
			unitUserAliases: [],
			unitUserEntries: [],
			userFoodPreferences: this.foodPreference ? [this.foodPreference] : [],
			userFoodDisplayPreferences: [],
			userUnitDisplayPreferences: []
		};
	}
	async writeUserFoodPreference(input: {
		aggregate: UserFoodPreference;
	}): Promise<UserFoodPreference> {
		this.calls.push('writeUserFoodPreference');
		this.foodPreference = input.aggregate;
		return input.aggregate;
	}
}

const principal = {
	keyId: 'key_test',
	ownerUserId,
	scopes: MAAL_API_SCOPES,
	effectiveHouseholds: [
		{
			householdId,
			householdName: 'Family',
			membershipId: 'membership_alice',
			roleSlug: 'admin',
			permissions: [
				'households:write',
				'recipes:read',
				'recipes:write',
				'meals:read',
				'meals:write'
			]
		}
	],
	authenticatedAt: '2026-08-22T12:00:00.000Z'
} as const;

const contextFor = (domain: SpyDomain, overrides: Partial<McpContext> = {}): McpContext => ({
	principal,
	domain,
	limiter: { limit: async () => ({ success: true }) },
	fetchRecipeCandidate: async () => candidateFromToolRecipe({ title: 'Imported soup' }),
	administration: {
		createInvite: async () => ({ code: 'INVITECODE12', invite: {} as never }),
		revokeInvite: async () => ({}) as never,
		updateMemberRole: async () => ({}) as never,
		removeMember: async () => undefined
	},
	...overrides
});

const recipeInput = {
	title: 'New soup',
	ingredients: ['water'],
	instructions: ['Simmer.']
};

const adapterCases: ReadonlyArray<{
	name: (typeof tools)[number]['name'];
	args: Record<string, unknown>;
	expected: readonly string[];
}> = [
	{ name: 'list_user_households', args: {}, expected: ['listHouseholds'] },
	{ name: 'list_user_recipes', args: {}, expected: ['listUserRecipes'] },
	{
		name: 'get_user_recipe',
		args: { recipeId: existingRecipe.id },
		expected: ['getUserRecipe']
	},
	{
		name: 'create_user_recipe',
		args: { recipe: recipeInput },
		expected: ['writeUserRecipe']
	},
	{
		name: 'update_user_recipe',
		args: { recipeId: existingRecipe.id, patch: { title: 'Updated soup' } },
		expected: ['getUserRecipe', 'writeUserRecipe']
	},
	{
		name: 'delete_user_recipe',
		args: { recipeId: existingRecipe.id },
		expected: ['getUserRecipe', 'writeUserRecipe']
	},
	{
		name: 'list_household_plan',
		args: { startDate: '2026-08-01', endDate: '2026-09-01' },
		expected: ['listHouseholdMeals']
	},
	{
		name: 'create_household_meal',
		args: { customMeal: recipeInput, date: '2026-08-24' },
		expected: ['writeHouseholdMeal']
	},
	{
		name: 'create_household_meals',
		args: { meals: [{ customMeal: recipeInput }, { userRecipeId: existingRecipe.id }] },
		expected: ['writeHouseholdMeal', 'getUserRecipe', 'ensureRecipeVersion', 'writeHouseholdMeal']
	},
	{
		name: 'get_household_meal',
		args: { mealId: existingMeal.id },
		expected: ['getHouseholdMeal']
	},
	{
		name: 'update_household_meal',
		args: { mealId: existingMeal.id, patch: { date: '2026-08-25' } },
		expected: ['getHouseholdMeal', 'writeHouseholdMeal']
	},
	{
		name: 'delete_household_meal',
		args: { mealId: existingMeal.id },
		expected: ['getHouseholdMeal', 'writeHouseholdMeal']
	},
	{
		name: 'create_meal_check_in',
		args: { mealId: existingMeal.id, verdict: 'repeat', cooked: true },
		expected: ['getHouseholdMeal', 'getMealCheckIn', 'writeMealCheckIn', 'writeHouseholdMeal']
	},
	{ name: 'list_meal_check_ins', args: {}, expected: ['listMealCheckIns'] },
	{ name: 'get_food_profile', args: {}, expected: ['getUserFoodProfile'] },
	{
		name: 'set_food_preference',
		args: { foodId: 'food_onion', preference: 'like' },
		expected: ['getUserFoodProfile', 'writeUserFoodPreference']
	},
	{ name: 'create_household_invite', args: { roleSlug: 'member', expiresInDays: 7 }, expected: [] },
	{ name: 'revoke_household_invite', args: { inviteId: 'invite_1' }, expected: [] },
	{
		name: 'update_household_member_role',
		args: { membershipId: 'membership_bob', roleSlug: 'member' },
		expected: []
	},
	{ name: 'remove_household_member', args: { membershipId: 'membership_bob' }, expected: [] }
];

describe('MCP tool adapters', () => {
	test('recipe patches preserve unexposed imported fields and accept zero values', () => {
		const imported = createRecipeAggregate({
			ownerUserId,
			candidate: {
				...candidateFromToolRecipe(recipeInput),
				totalTimeMinutes: 45,
				sourceYieldText: 'Serves four',
				sourceClaimedMinutes: 40,
				sourceHtmlHash: 'sha256:example'
			}
		});
		const patched = patchRecipe(imported, { title: 'Updated', prepTimeMinutes: 0 });
		expect(patched).toMatchObject({
			title: 'Updated',
			prepTimeMinutes: 0,
			totalTimeMinutes: 45,
			sourceYieldText: 'Serves four',
			sourceClaimedMinutes: 40,
			sourceHtmlHash: 'sha256:example'
		});
		expect(patched.ingredients).toEqual(imported.ingredients);
		expect(patched.instructions).toEqual(imported.instructions);
	});

	test.each(adapterCases)(
		'$name calls only the shared typed domain port',
		async ({ name, args, expected }) => {
			const domain = new SpyDomain();
			const definition = tools.find((tool) => tool.name === name)!;
			await definition.handler(contextFor(domain), args);
			expect(domain.calls).toEqual(expected);
		}
	);

	test('planning a saved recipe writes a recipe-following meal with no recipe content', async () => {
		const domain = new SpyDomain();
		await tools
			.find(({ name }) => name === 'create_household_meal')!
			.handler(contextFor(domain), { userRecipeId: existingRecipe.id });
		const [planned] = domain.mealWrites;
		expect(planned!.aggregate).toMatchObject({
			followsRecipe: true,
			sourceRecipeId: existingRecipe.id
		});
		expect(planned!.aggregate).not.toHaveProperty('title');
	});

	test('a substitution copies a recipe-following meal first, as its own write', async () => {
		const domain = new SpyDomain();
		await tools
			.find(({ name }) => name === 'update_household_meal')!
			.handler(contextFor(domain), {
				mealId: existingMeal.id,
				patch: { ingredients: ['1 leek'] }
			});
		expect(domain.mealWrites.map(({ conflictGroups }) => conflictGroups)).toEqual([
			MEAL_COPY_GROUPS,
			['ingredients']
		]);
		expect(domain.mealWrites[0]!.aggregate).toMatchObject({ title: 'Existing soup' });
		expect(domain.meal).toMatchObject({ followsRecipe: false });
		expect(domain.meal.ingredients.map(({ originalText }) => originalText)).toEqual(['1 leek']);
	});

	test('a schedule change keeps the meal following its recipe', async () => {
		const domain = new SpyDomain();
		await tools
			.find(({ name }) => name === 'update_household_meal')!
			.handler(contextFor(domain), { mealId: existingMeal.id, patch: { date: '2026-08-25' } });
		expect(domain.mealWrites.map(({ conflictGroups }) => conflictGroups)).toEqual([['schedule']]);
	});

	test('URL meal import consumes the limiter, parses once, then writes recipe and meal through the port', async () => {
		const domain = new SpyDomain();
		const order: string[] = [];
		const candidate = candidateFromToolRecipe({ title: 'URL soup' });
		const fetchCandidate = vi.fn(async (): Promise<RecipeImportedCandidate> => {
			order.push('fetch');
			return candidate;
		});
		const instrumentedDomain = new Proxy(domain, {
			get(target, property, receiver) {
				if (property === 'writeUserRecipe') {
					return async (input: Parameters<RemoteDomainPort['writeUserRecipe']>[0]) => {
						order.push('recipe-write');
						return target.writeUserRecipe(input);
					};
				}
				if (property === 'writeHouseholdMeal') {
					return async (input: Parameters<RemoteDomainPort['writeHouseholdMeal']>[0]) => {
						order.push('meal-write');
						return target.writeHouseholdMeal(input);
					};
				}
				const value: unknown = Reflect.get(target, property, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
		const context = contextFor(domain, {
			limiter: {
				limit: async () => {
					order.push('limit');
					return { success: true };
				}
			},
			fetchRecipeCandidate: fetchCandidate,
			domain: instrumentedDomain
		});
		await tools
			.find(({ name }) => name === 'create_household_meal')!
			.handler(context, { url: 'https://recipes.example/soup' });
		expect(fetchCandidate).toHaveBeenCalledOnce();
		expect(order).toEqual(['limit', 'fetch', 'recipe-write', 'meal-write']);
	});

	test('role and scope failures happen before a domain query', async () => {
		const domain = new SpyDomain();
		const context = contextFor(domain, {
			principal: { ...principal, scopes: ['households:read'] }
		});
		await expect(
			tools
				.find(({ name }) => name === 'create_user_recipe')!
				.handler(context, {
					recipe: recipeInput
				})
		).rejects.toMatchObject({ code: 'insufficient_scope' });
		expect(domain.calls).toEqual([]);
	});

	test('household administration tools delegate only after scope and role authorization', async () => {
		const domain = new SpyDomain();
		const createInvite = vi.fn<McpContext['administration']['createInvite']>(async () => ({
			code: 'INVITECODE12',
			invite: {} as never
		}));
		const context = contextFor(domain, {
			administration: {
				createInvite,
				revokeInvite: vi.fn(async () => ({}) as never),
				updateMemberRole: vi.fn(async () => ({}) as never),
				removeMember: vi.fn(async () => undefined)
			}
		});
		await tools
			.find(({ name }) => name === 'create_household_invite')!
			.handler(context, {
				roleSlug: 'child',
				expiresInDays: 30,
				maxUses: 2
			});
		expect(createInvite).toHaveBeenCalledWith({
			householdId,
			roleSlug: 'child',
			expiresInDays: 30,
			maxUses: 2
		});
	});

	test.each([
		['households:write', 'create_household_invite', { roleSlug: 'member', expiresInDays: 7 }],
		['check_ins:read', 'list_meal_check_ins', {}],
		['food_profile:read', 'get_food_profile', {}],
		['food_profile:write', 'set_food_preference', { foodId: 'food_onion', preference: 'like' }]
	] as const)('%s scope is enforced by its public tool', async (scope, name, args) => {
		const domain = new SpyDomain();
		const context = contextFor(domain, {
			principal: {
				...principal,
				scopes: principal.scopes.filter((candidate) => candidate !== scope)
			}
		});
		await expect(
			tools.find((tool) => tool.name === name)!.handler(context, args)
		).rejects.toMatchObject({ code: 'insufficient_scope' });
		expect(domain.calls).toEqual([]);
	});

	test.each([
		['list_meal_check_ins', {}, 'meals:read'],
		['get_food_profile', {}, 'recipes:read'],
		['set_food_preference', { foodId: 'food_onion', preference: 'like' }, 'recipes:write']
	] as const)('%s checks its projected household permission', async (name, args, permission) => {
		const domain = new SpyDomain();
		const context = contextFor(domain, {
			principal: {
				...principal,
				effectiveHouseholds: [
					{
						...principal.effectiveHouseholds[0],
						permissions: principal.effectiveHouseholds[0].permissions.filter(
							(candidate) => candidate !== permission
						)
					}
				]
			}
		});
		await expect(
			tools.find((tool) => tool.name === name)!.handler(context, args)
		).rejects.toMatchObject({ code: 'insufficient_role_permission' });
		expect(domain.calls).toEqual([]);
	});
});

const runTool = (domain: SpyDomain, name: (typeof tools)[number]['name'], args: object) =>
	tools.find((tool) => tool.name === name)!.handler(contextFor(domain), { ...args });

describe('MCP tool parity with the prototype', () => {
	test('update_household_meal replaces ingredients and instructions and writes only patched groups', async () => {
		const domain = new SpyDomain();
		domain.meal = {
			...existingMeal,
			instructionEvents: [
				{
					id: '01900000-0000-7000-8000-000000000001',
					mealInstructionId: existingMeal.instructions[0]!.id,
					kind: 'action',
					appliance: null,
					sourceText: 'Simmer',
					value: null,
					unitId: null,
					baseValue: null,
					baseUnitId: null,
					confidence: 1,
					createdAt: existingMeal.createdAt
				}
			]
		};
		const result = (await runTool(domain, 'update_household_meal', {
			mealId: existingMeal.id,
			patch: { ingredients: ['2 leeks'], instructions: ['Roast.'] }
		})) as { meal: RemoteMeal };

		expect(result.meal.ingredients.map(({ originalText }) => originalText)).toEqual(['2 leeks']);
		expect(result.meal.instructions.map(({ text }) => text)).toEqual(['Roast.']);
		expect(result.meal.instructionEvents).toEqual([]);
		expect(domain.mealWrites.at(-1)?.conflictGroups).toEqual(['ingredients', 'instructions']);
	});

	test('update_household_meal maps schedule and header fields to their own groups', async () => {
		const domain = new SpyDomain();
		await runTool(domain, 'update_household_meal', {
			mealId: existingMeal.id,
			patch: { date: '2026-08-30', title: 'Renamed soup' }
		});
		expect(domain.mealWrites.at(-1)?.conflictGroups).toEqual(['header', 'schedule']);
	});

	test.each([
		['a member who was not the planned cook', 'user_bob', true],
		['a skipped meal', ownerUserId, false]
	])('create_meal_check_in ignores cook time from %s', async (_case, plannedCookUserId, cooked) => {
		const domain = new SpyDomain();
		domain.meal = { ...existingMeal, plannedCookUserId };
		const result = (await runTool(domain, 'create_meal_check_in', {
			mealId: existingMeal.id,
			verdict: 'repeat',
			cooked,
			cookTime: 40
		})) as { checkIn: MealCheckIn };
		expect(result.checkIn.cookTimeMinutes).toBeNull();
	});

	test('create_meal_check_in pins the version a following meal shows and copies nothing', async () => {
		const domain = new SpyDomain();
		const result = (await runTool(domain, 'create_meal_check_in', {
			mealId: existingMeal.id,
			verdict: 'repeat'
		})) as { checkIn: MealCheckIn };
		expect(result.checkIn.recipeVersionId).toBe(existingMeal.recipeVersionId);
		expect(domain.mealWrites.map(({ conflictGroups }) => conflictGroups)).toEqual([['status']]);
	});

	test('create_meal_check_in keeps cook time from the planned cook who cooked', async () => {
		const domain = new SpyDomain();
		domain.meal = { ...existingMeal, plannedCookUserId: ownerUserId };
		const result = (await runTool(domain, 'create_meal_check_in', {
			mealId: existingMeal.id,
			verdict: 'repeat',
			cookTime: 40
		})) as { checkIn: MealCheckIn };
		expect(result.checkIn.cookTimeMinutes).toBe(40);
	});

	test('create_household_meals reports each item with its real reason and title', async () => {
		const result = (await runTool(new SpyDomain(), 'create_household_meals', {
			meals: [{ userRecipeId: 'missing', customMeal: { title: 'Both sources' } }]
		})) as { errors: unknown[] };
		expect(result.errors).toEqual([
			{
				index: 0,
				meal: 'Both sources',
				url: null,
				code: 'create_failed',
				message: 'Pass exactly one meal source: url, userRecipeId, recipe, or customMeal.'
			}
		]);
	});
});

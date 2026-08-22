import { describe, expect, test, vi } from 'vitest';

import type { MealAggregate, MealCheckIn } from '$lib/domain/meals/schema.js';
import type { RecipeAggregate, RecipeImportedCandidate } from '$lib/domain/recipes/schema.js';
import {
	cloneRecipeAsMeal,
	createRecipeAggregate,
	linkedMealMatchesRecipeSnapshot,
	type RemoteDomainPort,
	type RemoteHouseholdSummary
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
const existingMeal = cloneRecipeAsMeal({
	recipe: existingRecipe,
	householdId,
	date: '2026-08-23'
});

class SpyDomain implements RemoteDomainPort {
	readonly calls: string[] = [];
	recipe = existingRecipe;
	meal = existingMeal;
	checkIn: MealCheckIn | null = null;

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
	async writeUserRecipe(input: { aggregate: RecipeAggregate }): Promise<RecipeAggregate> {
		this.calls.push('writeUserRecipe');
		this.recipe = input.aggregate;
		return this.recipe;
	}
	async listHouseholdMeals(): Promise<readonly MealAggregate[]> {
		this.calls.push('listHouseholdMeals');
		return [this.meal];
	}
	async getHouseholdMeal(): Promise<MealAggregate | null> {
		this.calls.push('getHouseholdMeal');
		return this.meal;
	}
	async writeHouseholdMeal(input: { aggregate: MealAggregate }): Promise<MealAggregate> {
		this.calls.push('writeHouseholdMeal');
		this.meal = input.aggregate;
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
			permissions: MAAL_API_SCOPES
		}
	],
	authenticatedAt: '2026-08-22T12:00:00.000Z'
} as const;

const contextFor = (domain: SpyDomain, overrides: Partial<McpContext> = {}): McpContext => ({
	principal,
	domain,
	limiter: { limit: async () => ({ success: true }) },
	fetchRecipeCandidate: async () => candidateFromToolRecipe({ title: 'Imported soup' }),
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
		expected: ['getUserRecipe', 'writeUserRecipe', 'listHouseholdMeals', 'writeHouseholdMeal']
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
		expected: ['writeHouseholdMeal', 'getUserRecipe', 'writeHouseholdMeal']
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
	}
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

	test('recipe propagation preserves scheduled meal state and skips ad-hoc overrides', async () => {
		const domain = new SpyDomain();
		const definition = tools.find(({ name }) => name === 'update_user_recipe')!;
		await definition.handler(contextFor(domain), {
			recipeId: existingRecipe.id,
			patch: { title: 'Updated soup' }
		});
		expect(domain.meal).toMatchObject({
			title: 'Updated soup',
			date: existingMeal.date,
			status: existingMeal.status,
			sourceRecipeId: existingRecipe.id
		});
		expect(linkedMealMatchesRecipeSnapshot(domain.meal, domain.recipe)).toBe(true);

		const overridden = new SpyDomain();
		overridden.meal = { ...overridden.meal, title: 'My ad-hoc title' };
		await definition.handler(contextFor(overridden), {
			recipeId: existingRecipe.id,
			patch: { title: 'Another title' }
		});
		expect(overridden.meal.title).toBe('My ad-hoc title');
		expect(overridden.calls).not.toContain('writeHouseholdMeal');
	});

	test('recipe propagation skips paid households without live and projected meals write access', async () => {
		const domain = new SpyDomain();
		const definition = tools.find(({ name }) => name === 'update_user_recipe')!;
		await definition.handler(
			contextFor(domain, {
				principal: {
					...principal,
					effectiveHouseholds: [
						{ ...principal.effectiveHouseholds[0], permissions: ['recipes:write'] }
					]
				}
			}),
			{ recipeId: existingRecipe.id, patch: { title: 'Private update' } }
		);
		expect(domain.calls).toEqual(['getUserRecipe', 'writeUserRecipe']);
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
});

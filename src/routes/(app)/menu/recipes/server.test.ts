import { describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';

const requireBillingAppContext = vi.fn();
const loadMenuRecipes = vi.fn();
const replaceRecipeIngredients = vi.fn();
const replaceRecipeInstructions = vi.fn();
const loadHouseholdUnitPreferences = vi.fn();

vi.mock('$lib/server/http/app-context', () => ({ requireBillingAppContext }));
vi.mock('$lib/server/db/recipe-mappers', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/db/recipe-mappers')>(
		'$lib/server/db/recipe-mappers'
	);
	return {
		...actual,
		loadMenuRecipes,
		replaceRecipeIngredients,
		replaceRecipeInstructions
	};
});
vi.mock('$lib/server/taxonomy/household-preferences', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/server/taxonomy/household-preferences')
	>('$lib/server/taxonomy/household-preferences');
	return {
		...actual,
		loadHouseholdUnitPreferences
	};
});

const { POST } = await import('./+server');

type MenuRecipesEvent = Parameters<typeof POST>[0];

const session = createAuthSession();
const platform = { env: { DB: {} as D1Database } } as App.Platform;
const url = new URL('https://maal.test/menu/recipes');

const event = (body: Record<string, unknown>): MenuRecipesEvent =>
	({
		cookies: {} as MenuRecipesEvent['cookies'],
		locals: { session },
		platform,
		request: new Request(url, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		}),
		url
	}) as MenuRecipesEvent;

const createDb = () => {
	const db = {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn().mockResolvedValue([])
			}))
		})),
		insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
		transaction: vi.fn(() => {
			throw new Error('Failed query: begin');
		})
	};
	return db;
};

describe('menu recipes API', () => {
	it('creates a recipe without entering the D1 transaction begin path', async () => {
		const db = createDb();
		requireBillingAppContext.mockResolvedValue({
			db,
			householdId: 'household_1',
			session
		});
		loadHouseholdUnitPreferences.mockResolvedValue({ system: 'metric' });
		loadMenuRecipes.mockResolvedValue([
			{
				id: 'recipe_1',
				title: 'Pancakes',
				ingredients: [],
				instructions: []
			}
		]);

		const response = await POST(event({ title: 'Pancakes' }));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toMatchObject({ recipe: { title: 'Pancakes' } });
		expect(db.transaction).not.toHaveBeenCalled();
		expect(db.insert).toHaveBeenCalledOnce();
		expect(replaceRecipeIngredients).toHaveBeenCalledWith(db, expect.any(String), []);
		expect(replaceRecipeInstructions).toHaveBeenCalledWith(db, expect.any(String), []);
	});
});

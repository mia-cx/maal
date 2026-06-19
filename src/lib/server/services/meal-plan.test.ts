import { beforeEach, describe, expect, it, vi } from 'vitest';

const countActiveHouseholdMembers = vi.fn();
const listHouseholdMembers = vi.fn();
const loadMealPlanMeals = vi.fn();
const replaceMealIngredientsFromLines = vi.fn();
const replaceMealInstructionsFromLines = vi.fn();
const loadHouseholdUnitPreferences = vi.fn();
const d1Batch = vi.fn();

vi.mock('$lib/server/auth/household', () => ({
	countActiveHouseholdMembers,
	listHouseholdMembers
}));
vi.mock('$lib/server/db/recipe-mappers', () => ({
	loadMealPlanMeals
}));
vi.mock('$lib/server/services/meal-sidecar-writer', () => ({
	replaceMealIngredientsFromLines,
	replaceMealInstructionsFromLines
}));
vi.mock('$lib/server/taxonomy/household-preferences', () => ({
	loadHouseholdUnitPreferences
}));
vi.mock('$lib/server/db/d1-batch', () => ({
	d1Batch,
	requireD1Database: vi.fn(() => ({}))
}));

const { createHouseholdMeal, updateHouseholdMeal } = await import('./meal-plan');

const createDb = (existingMeal?: Record<string, unknown>) => ({
	insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
	delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
	update: vi.fn(() => ({
		set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
	})),
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({ get: vi.fn().mockResolvedValue(existingMeal) }))
		}))
	})),
	transaction: vi.fn(() => {
		throw new Error('Failed query: begin');
	})
});

describe('meal plan service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	it('creates custom meals without entering the D1 transaction begin path', async () => {
		const db = createDb();
		countActiveHouseholdMembers.mockResolvedValue(2);
		listHouseholdMembers.mockResolvedValue([{ userId: 'user_1' }]);
		loadHouseholdUnitPreferences.mockResolvedValue({ system: 'metric' });
		loadMealPlanMeals.mockImplementation((_db, options) => [
			{
				id: options.mealId,
				title: 'Soup',
				householdId: 'household_1',
				plannedCookUserId: 'user_1'
			}
		]);

		await expect(
			createHouseholdMeal({
				platform: undefined,
				db: db as never,
				meal: {
					householdId: 'household_1',
					workosUserId: 'user_1',
					customMeal: { title: 'Soup', ingredients: ['water'], instructions: ['Simmer'] }
				}
			})
		).resolves.toMatchObject({ title: 'Soup' });

		expect(db.transaction).not.toHaveBeenCalled();
		expect(db.insert).toHaveBeenCalledOnce();
		expect(replaceMealIngredientsFromLines).toHaveBeenCalledWith(db, expect.any(String), ['water']);
		expect(replaceMealInstructionsFromLines).toHaveBeenCalledWith(db, expect.any(String), [
			'Simmer'
		]);
	});

	it('updates meals without entering the D1 transaction begin path', async () => {
		const db = createDb({
			id: 'meal_1',
			householdId: 'household_1',
			plannedCookWorkosUserId: 'user_1',
			plannedYield: 2,
			status: 'planned'
		});
		listHouseholdMembers.mockResolvedValue([{ userId: 'user_1' }]);
		loadHouseholdUnitPreferences.mockResolvedValue({ system: 'metric' });
		loadMealPlanMeals.mockResolvedValue([
			{
				id: 'meal_1',
				title: 'Soup',
				householdId: 'household_1',
				plannedCookUserId: 'user_1'
			}
		]);

		await expect(
			updateHouseholdMeal({
				platform: undefined,
				db: db as never,
				meal: {
					householdId: 'household_1',
					workosUserId: 'user_1',
					mealId: 'meal_1',
					patch: { servingsPlanned: 4, ingredients: ['4 cups water'] }
				}
			})
		).resolves.toMatchObject({ id: 'meal_1' });

		expect(db.transaction).not.toHaveBeenCalled();
		expect(d1Batch).toHaveBeenCalledOnce();
		expect(replaceMealIngredientsFromLines).not.toHaveBeenCalled();
	});
});

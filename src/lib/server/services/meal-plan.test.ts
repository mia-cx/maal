import { describe, expect, it, vi } from 'vitest';

const countActiveHouseholdMembers = vi.fn();
const listHouseholdMembers = vi.fn();
const loadMealPlanMeals = vi.fn();
const replaceMealIngredientsFromLines = vi.fn();
const replaceMealInstructionsFromLines = vi.fn();
const loadHouseholdUnitPreferences = vi.fn();

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

const { createHouseholdMeal } = await import('./meal-plan');

const createDb = () => ({
	insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
	transaction: vi.fn(() => {
		throw new Error('Failed query: begin');
	})
});

describe('meal plan service', () => {
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
});

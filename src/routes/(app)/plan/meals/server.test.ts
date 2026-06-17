import { describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';

const requireBillingAppContext = vi.fn();
const createHouseholdMeal = vi.fn();

vi.mock('$lib/server/http/app-context', () => ({ requireBillingAppContext }));
vi.mock('$lib/server/services/meal-plan', () => ({
	createHouseholdMeal,
	defaultMealServings: vi.fn(),
	deleteHouseholdMeal: vi.fn(),
	listHouseholdPlanMeals: vi.fn(),
	updateHouseholdMeal: vi.fn()
}));

const { POST } = await import('./+server');

type PlanMealsEvent = Parameters<typeof POST>[0];

const session = createAuthSession();
const platform = { env: { DB: {} as D1Database } } as App.Platform;
const url = new URL('https://maal.test/plan/meals');

const event = (meal: Record<string, unknown>): PlanMealsEvent =>
	({
		cookies: {} as PlanMealsEvent['cookies'],
		locals: { session },
		platform,
		request: new Request(url, {
			method: 'POST',
			body: JSON.stringify({ meal }),
			headers: { 'content-type': 'application/json' }
		}),
		url
	}) as PlanMealsEvent;

describe('plan meals API', () => {
	it('rejects empty meal status values before service conversion', async () => {
		requireBillingAppContext.mockResolvedValue({
			db: {},
			householdId: 'household_1',
			session
		});

		await expect(POST(event({ id: 'meal_1', title: 'Dinner', status: '' }))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Meal status is invalid.' }
		});
		expect(createHouseholdMeal).not.toHaveBeenCalled();
	});
});

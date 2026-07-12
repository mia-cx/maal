import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertMealCheckInCore = vi.fn();

vi.mock('./meal-check-ins', () => ({
	upsertMealCheckIn: upsertMealCheckInCore
}));

const { upsertMealCheckIn } = await import('./check-ins');

const validInput = {
	db: {} as never,
	workosUserId: 'user_1',
	householdId: 'household_1',
	mealId: ' meal_1 ',
	verdict: 'repeat' as const,
	cooked: true,
	cookTime: '24',
	reason: 'Great'
};

describe('upsertMealCheckIn service validation', () => {
	beforeEach(() => {
		upsertMealCheckInCore.mockReset();
	});

	it('normalizes valid check-in input before calling the core writer', async () => {
		upsertMealCheckInCore.mockResolvedValue(undefined);

		await expect(upsertMealCheckIn(validInput)).resolves.toEqual({ ok: true });

		expect(upsertMealCheckInCore).toHaveBeenCalledWith(validInput.db, {
			householdId: 'household_1',
			workosUserId: 'user_1',
			mealId: 'meal_1',
			verdict: 'repeat',
			cooked: true,
			cookTime: 24,
			reason: 'Great'
		});
	});

	it('rejects malformed cooked and cook time values instead of silently dropping them', async () => {
		await expect(upsertMealCheckIn({ ...validInput, cooked: 'true' })).rejects.toThrow(
			'Cooked must be true or false.'
		);
		await expect(upsertMealCheckIn({ ...validInput, cookTime: '1.9' })).rejects.toThrow(
			'Cook time must be a positive whole number.'
		);
		await expect(upsertMealCheckIn({ ...validInput, cookTime: -1 })).rejects.toThrow(
			'Cook time must be a positive whole number.'
		);
		expect(upsertMealCheckInCore).not.toHaveBeenCalled();
	});
});

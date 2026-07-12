import { describe, expect, it } from 'vitest';
import { readMealCheckInInput } from './meal-check-in-input';

const jsonRequest = (body: unknown) =>
	new Request('https://maal.test/plan/check-ins', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

describe('readMealCheckInInput', () => {
	it('decodes valid check-in input', async () => {
		await expect(
			readMealCheckInInput(
				jsonRequest({
					mealId: ' meal_1 ',
					verdict: 'repeat',
					cooked: true,
					cookTime: '24',
					reason: ' Great '
				}),
				'household_1',
				'user_1'
			)
		).resolves.toEqual({
			householdId: 'household_1',
			workosUserId: 'user_1',
			mealId: 'meal_1',
			verdict: 'repeat',
			cooked: true,
			cookTime: 24,
			reason: 'Great'
		});
	});

	it('defaults cooked to true and rejects coercive values', async () => {
		await expect(
			readMealCheckInInput(
				jsonRequest({ mealId: 'meal_1', verdict: 'neutral' }),
				'household_1',
				'user_1'
			)
		).resolves.toMatchObject({ cooked: true, cookTime: null });
		await expect(
			readMealCheckInInput(
				jsonRequest({ mealId: 'meal_1', verdict: 'neutral', cooked: 'true' }),
				'household_1',
				'user_1'
			)
		).rejects.toMatchObject({ status: 400, body: { message: 'Cooked must be true or false.' } });
		await expect(
			readMealCheckInInput(
				jsonRequest({ mealId: 'meal_1', verdict: 'neutral', cookTime: '1.9' }),
				'household_1',
				'user_1'
			)
		).rejects.toMatchObject({
			status: 400,
			body: { message: 'Cook time must be a positive whole number.' }
		});
	});

	it('rejects missing meal id and invalid verdict', async () => {
		await expect(
			readMealCheckInInput(jsonRequest({ verdict: 'repeat' }), 'household_1', 'user_1')
		).rejects.toMatchObject({ status: 400, body: { message: 'Meal is required.' } });
		await expect(
			readMealCheckInInput(
				jsonRequest({ mealId: 'meal_1', verdict: 'nope' }),
				'household_1',
				'user_1'
			)
		).rejects.toMatchObject({ status: 400, body: { message: 'Verdict is required.' } });
	});
});

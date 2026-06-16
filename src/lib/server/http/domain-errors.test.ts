import { describe, expect, it } from 'vitest';
import { DomainError, mapKnownError } from './domain-errors';

describe('mapKnownError', () => {
	it('maps known domain error codes to HTTP errors', () => {
		expect(() =>
			mapKnownError(new DomainError('meal_not_found', 'internal wording'), {
				meal_not_found: { status: 404, message: 'Meal not found.' }
			})
		).toThrowError(expect.objectContaining({ status: 404, body: { message: 'Meal not found.' } }));
	});

	it('rethrows unmapped domain errors', () => {
		const cause = new DomainError('recipe_not_found', 'Recipe not found.');

		expect(() => mapKnownError(cause, {})).toThrow(cause);
	});

	it('rethrows plain errors with matching messages', () => {
		const cause = new Error('Meal not found.');

		expect(() =>
			mapKnownError(cause, { meal_not_found: { status: 404, message: 'Meal not found.' } })
		).toThrow(cause);
	});
});

export type DomainErrorCode =
	| 'active_household_cook_required'
	| 'meal_not_found'
	| 'recipe_not_found';

export class DomainError extends Error {
	constructor(
		readonly code: DomainErrorCode,
		message: string
	) {
		super(message);
		this.name = 'DomainError';
	}
}

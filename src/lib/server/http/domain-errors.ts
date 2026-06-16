import { error } from '@sveltejs/kit';

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

type KnownErrorResponse = {
	message: string;
	status: number;
};

export const mapKnownError = (
	cause: unknown,
	responses: Partial<Record<DomainErrorCode, KnownErrorResponse>>
): never => {
	if (cause instanceof DomainError && Object.hasOwn(responses, cause.code)) {
		const response = responses[cause.code];
		if (response) error(response.status, { message: response.message });
	}
	throw cause;
};

import { error } from '@sveltejs/kit';
import { DomainError, type DomainErrorCode } from '$lib/server/domain-errors';

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

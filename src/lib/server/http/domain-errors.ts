import { error } from '@sveltejs/kit';

export const mapKnownError = (cause: unknown, messages: Record<string, number>): never => {
	if (cause instanceof Error) {
		const status = messages[cause.message];
		if (status) error(status, { message: cause.message });
	}
	throw cause;
};

import { json } from '@sveltejs/kit';

export function taggedErrorResponse(error: unknown) {
	const tag =
		typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string'
			? error._tag
			: 'AuthSlotUnavailable';
	const status =
		tag === 'AuthSlotIdentityMismatch'
			? 403
			: tag === 'AuthSlotAlreadyBound'
				? 409
				: tag === 'AuthSlotBindingMissing'
					? 401
					: tag === 'AuthSlotCookieTooLarge'
						? 502
						: tag === 'AuthSlotConfigurationError' || tag === 'AuthSlotUnavailable'
							? 503
							: 400;
	return json({ error: { _tag: tag } }, { status });
}

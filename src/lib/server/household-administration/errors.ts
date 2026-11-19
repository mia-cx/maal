import { Data } from 'effect';

import type { HouseholdAdministrationErrorCode } from '$lib/domain/household/administration.js';

export class HouseholdAdministrationError extends Data.TaggedError('HouseholdAdministrationError')<{
	readonly code: HouseholdAdministrationErrorCode;
	readonly cause?: unknown;
}> {}

export const asHouseholdAdministrationError = (
	cause: unknown,
	code: HouseholdAdministrationErrorCode
): HouseholdAdministrationError =>
	cause instanceof HouseholdAdministrationError
		? cause
		: new HouseholdAdministrationError({ code, cause });

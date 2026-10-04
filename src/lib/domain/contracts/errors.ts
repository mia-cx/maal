import { Data } from 'effect';

interface LocalErrorFields {
	readonly operation: string;
	readonly message: string;
}

export class LocalDecodeError extends Data.TaggedError('LocalDecodeError')<LocalErrorFields> {}

export class LocalPersistenceError extends Data.TaggedError(
	'LocalPersistenceError'
)<LocalErrorFields> {}

export class LocalQuotaExceededError extends Data.TaggedError(
	'LocalQuotaExceededError'
)<LocalErrorFields> {}

export class LocalMigrationError extends Data.TaggedError(
	'LocalMigrationError'
)<LocalErrorFields> {}

export class LocalRecoveryRequiredError extends Data.TaggedError('LocalRecoveryRequiredError')<
	LocalErrorFields & { readonly recoveryCode: string }
> {}

export class LocalRecoveryConfirmationError extends Data.TaggedError(
	'LocalRecoveryConfirmationError'
)<LocalErrorFields> {}

export class TaxonomyInvariantError extends Data.TaggedError(
	'TaxonomyInvariantError'
)<LocalErrorFields> {}

export class PortableArchiveError extends Data.TaggedError('PortableArchiveError')<
	LocalErrorFields & {
		readonly code:
			| 'invalid_zip'
			| 'resource_limit'
			| 'unsupported_version'
			| 'invalid_content'
			| 'unresolved_collision'
			| 'commit_failed';
	}
> {}

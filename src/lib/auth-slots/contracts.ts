import { Data, Schema } from 'effect';

import { UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import { HouseholdDiscoveryEntrySchema } from '$lib/domain/household/administration.js';

export const MAX_AUTHENTICATED_SLOTS = 8 as const;
export const AUTH_SLOT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const AuthSlotId = Schema.String.pipe(
	Schema.pattern(AUTH_SLOT_ID_PATTERN, {
		message: () => 'Auth slot IDs must contain 32 lowercase hexadecimal characters'
	})
);
export type AuthSlotId = typeof AuthSlotId.Type;

export const AuthSlotStatus = Schema.Literal('authenticated', 'stale', 'reauthRequired');
export type AuthSlotStatus = typeof AuthSlotStatus.Type;

const AuthSlotMetadataBase = {
	schemaVersion: Schema.Literal(1),
	authSlotId: AuthSlotId
} as const;

export const AuthenticatedAuthSlotMetadata = Schema.Struct({
	...AuthSlotMetadataBase,
	status: Schema.Literal('authenticated'),
	workosUserId: Schema.String,
	email: Schema.String,
	firstName: Schema.NullOr(Schema.String),
	lastName: Schema.NullOr(Schema.String),
	profilePictureUrl: Schema.NullOr(Schema.String),
	verifiedAt: UtcInstantSchema,
	households: Schema.optional(Schema.Array(HouseholdDiscoveryEntrySchema))
});
export type AuthenticatedAuthSlotMetadata = typeof AuthenticatedAuthSlotMetadata.Type;

export const UnauthenticatedAuthSlotMetadata = Schema.Struct({
	...AuthSlotMetadataBase,
	status: Schema.Literal('stale', 'reauthRequired')
});

export const AuthSlotMetadata = Schema.Union(
	AuthenticatedAuthSlotMetadata,
	UnauthenticatedAuthSlotMetadata
);
export type AuthSlotMetadata = typeof AuthSlotMetadata.Type;

export const AuthSlotProjection = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	profileId: Schema.String,
	authSlotId: AuthSlotId,
	workosUserId: Schema.String,
	status: AuthSlotStatus,
	email: Schema.String,
	firstName: Schema.NullOr(Schema.String),
	lastName: Schema.NullOr(Schema.String),
	profilePictureUrl: Schema.NullOr(Schema.String),
	lastVerifiedAt: Schema.NullOr(Schema.String)
});
export type AuthSlotProjection = typeof AuthSlotProjection.Type;

export class AuthSlotCapacityExceeded extends Data.TaggedError('AuthSlotCapacityExceeded')<{
	readonly maximum: typeof MAX_AUTHENTICATED_SLOTS;
}> {}

export class AuthSlotIdentityMismatch extends Data.TaggedError('AuthSlotIdentityMismatch')<{
	readonly expectedUserId: string;
	readonly actualUserId: string;
}> {}

export function createAuthSlotId(
	randomValues: (bytes: Uint8Array<ArrayBuffer>) => void = fillRandomValues
) {
	const bytes = new Uint8Array(16);
	randomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') as AuthSlotId;
}

export function isAuthSlotId(value: string): value is AuthSlotId {
	return AUTH_SLOT_ID_PATTERN.test(value);
}

export function assertAuthSlotCapacity(
	profiles: ReadonlyArray<Pick<AuthSlotProjection, 'authSlotId' | 'status'>>,
	replacingSlotId?: AuthSlotId
) {
	const retainedSlots = new Set(
		profiles
			.filter((profile) => profile.status !== 'reauthRequired')
			.map((profile) => profile.authSlotId)
	);

	if (replacingSlotId && retainedSlots.has(replacingSlotId)) return;
	if (retainedSlots.size >= MAX_AUTHENTICATED_SLOTS) {
		throw new AuthSlotCapacityExceeded({ maximum: MAX_AUTHENTICATED_SLOTS });
	}
}

export function assertReauthenticatedUser(expectedUserId: string, actualUserId: string) {
	if (expectedUserId !== actualUserId) {
		throw new AuthSlotIdentityMismatch({ expectedUserId, actualUserId });
	}
}

function fillRandomValues(bytes: Uint8Array<ArrayBuffer>) {
	crypto.getRandomValues(bytes);
}

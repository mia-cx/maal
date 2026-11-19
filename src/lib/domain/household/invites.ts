import { Data, Schema } from 'effect';

import { HouseholdRoleSchema, type HouseholdRole } from './contracts.js';

export const INVITE_CODE_LENGTH = 12 as const;
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' as const;

export const InviteExpiryDaysSchema = Schema.Literal(1, 7, 30);
export type InviteExpiryDays = typeof InviteExpiryDaysSchema.Type;

export const CreateHouseholdInviteInputSchema = Schema.Struct({
	householdId: Schema.String,
	roleSlug: HouseholdRoleSchema,
	expiresInDays: InviteExpiryDaysSchema,
	maxUses: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.between(1, 100)))
});
export type CreateHouseholdInviteInput = typeof CreateHouseholdInviteInputSchema.Type;

export class InvalidInviteCode extends Data.TaggedError('InvalidInviteCode')<
	Record<never, never>
> {}

export const normalizeInviteCode = (value: string): string =>
	value.toUpperCase().replaceAll(/[^A-Z0-9]/g, '');

export const isInviteCode = (value: string): boolean => {
	const normalized = normalizeInviteCode(value);
	return (
		normalized.length === INVITE_CODE_LENGTH &&
		[...normalized].every((character) => INVITE_ALPHABET.includes(character))
	);
};

export const createInviteCode = (
	randomValues: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => crypto.getRandomValues(bytes)
): string => {
	const bytes = new Uint8Array(INVITE_CODE_LENGTH);
	randomValues(bytes);
	return Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join('');
};

export const hashInviteCode = async (value: string): Promise<string> => {
	const normalized = normalizeInviteCode(value);
	if (!isInviteCode(normalized)) throw new InvalidInviteCode();
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const inviteExpiresAt = (days: InviteExpiryDays, now = Date.now()): `${string}Z` =>
	new Date(now + days * 86_400_000).toISOString() as `${string}Z`;

export const defaultInviteRole: HouseholdRole = 'member';

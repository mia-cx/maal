import { Data } from 'effect';
import type { AuthSlotId } from '$lib/auth-slots';
import { AUTH_CALLBACK_PATH } from './flow';

interface CookieSerializeOptions {
	readonly path?: string;
	readonly httpOnly?: boolean;
	readonly secure?: boolean;
	readonly sameSite?: 'lax' | 'strict' | 'none' | boolean;
	readonly maxAge?: number;
}

export const AUTH_SLOT_COOKIE_LIMIT_BYTES = 4096 as const;
export const AUTH_SLOT_COOKIE_PREFIX = '__Secure-maal_session_';
export const AUTH_FLOW_COOKIE_PREFIX = '__Secure-maal_auth_flow_';
export const AUTH_FLOW_MARKER_VALUE = 'pending' as const;
export const AUTH_IDENTITY_COOKIE_PREFIX = '__Secure-maal_identity_';
const RETAINED_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export class AuthSlotCookieTooLarge extends Data.TaggedError('AuthSlotCookieTooLarge')<{
	readonly actualBytes: number;
	readonly maximumBytes: typeof AUTH_SLOT_COOKIE_LIMIT_BYTES;
}> {}

export function authSlotPath(slotId: AuthSlotId) {
	return `/api/auth-slots/${slotId}/` as const;
}

export function authSlotCookieName(slotId: AuthSlotId) {
	return `${AUTH_SLOT_COOKIE_PREFIX}${slotId}` as const;
}

export function authFlowCookieName(nonce: string) {
	return `${AUTH_FLOW_COOKIE_PREFIX}${nonce}` as const;
}

export function authIdentityCookieName(slotId: AuthSlotId) {
	return `${AUTH_IDENTITY_COOKIE_PREFIX}${slotId}` as const;
}

export function authCookieOptions(slotId: AuthSlotId): CookieSerializeOptions & { path: string } {
	return {
		path: authSlotPath(slotId),
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: RETAINED_COOKIE_MAX_AGE_SECONDS
	};
}

export function authFlowCookieOptions(): CookieSerializeOptions & { path: string } {
	return {
		path: AUTH_CALLBACK_PATH,
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 10 * 60
	};
}

export function serializedCookieBytes(
	name: string,
	value: string,
	options: CookieSerializeOptions & { path: string }
) {
	const attributes = [
		`${name}=${value}`,
		`Path=${options.path}`,
		options.httpOnly ? 'HttpOnly' : undefined,
		options.secure ? 'Secure' : undefined,
		options.sameSite === 'lax' ? 'SameSite=Lax' : undefined,
		options.maxAge === undefined ? undefined : `Max-Age=${options.maxAge}`
	].filter((attribute): attribute is string => Boolean(attribute));

	return new TextEncoder().encode(attributes.join('; ')).byteLength;
}

export function assertAuthSlotCookieFits(slotId: AuthSlotId, sealedSession: string) {
	const actualBytes = serializedCookieBytes(
		authSlotCookieName(slotId),
		sealedSession,
		authCookieOptions(slotId)
	);

	if (actualBytes >= AUTH_SLOT_COOKIE_LIMIT_BYTES) {
		throw new AuthSlotCookieTooLarge({
			actualBytes,
			maximumBytes: AUTH_SLOT_COOKIE_LIMIT_BYTES
		});
	}

	return actualBytes;
}

import { Data } from 'effect';
import type { AuthSlotId } from '$lib/auth-slots';

export type AuthFlowPurpose = 'add-profile' | 'reauthenticate';

export interface AuthFlow {
	readonly state: string;
	readonly purpose: AuthFlowPurpose;
	readonly expectedUserId: string | null;
	readonly returnTo: string;
	readonly createdAt: string;
}

export class AuthSlotAlreadyBound extends Data.TaggedError('AuthSlotAlreadyBound')<
	Record<never, never>
> {}

export class AuthSlotBindingMissing extends Data.TaggedError('AuthSlotBindingMissing')<
	Record<never, never>
> {}

export function expectedUserForFlow(purpose: AuthFlowPurpose, boundUserId: string | null) {
	if (purpose === 'add-profile') {
		if (boundUserId) throw new AuthSlotAlreadyBound();
		return null;
	}
	if (!boundUserId) throw new AuthSlotBindingMissing();
	return boundUserId;
}

export function encodeAuthFlow(flow: AuthFlow) {
	const bytes = new TextEncoder().encode(JSON.stringify(flow));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeAuthFlow(value: string | undefined): AuthFlow | null {
	if (!value) return null;
	try {
		const normalized = value
			.replaceAll('-', '+')
			.replaceAll('_', '/')
			.padEnd(Math.ceil(value.length / 4) * 4, '=');
		const binary = atob(normalized);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<AuthFlow>;
		if (
			typeof parsed.state !== 'string' ||
			(parsed.purpose !== 'add-profile' && parsed.purpose !== 'reauthenticate') ||
			(parsed.expectedUserId !== null && typeof parsed.expectedUserId !== 'string') ||
			typeof parsed.returnTo !== 'string' ||
			typeof parsed.createdAt !== 'string'
		) {
			return null;
		}
		return parsed as AuthFlow;
	} catch {
		return null;
	}
}

export function safeReturnTo(value: string | null) {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
	return value;
}

export function callbackPath(origin: string, slotId: AuthSlotId) {
	return new URL(`/api/auth-slots/${slotId}/callback`, origin).toString();
}

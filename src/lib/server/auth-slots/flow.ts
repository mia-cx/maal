import { Data } from 'effect';
import { isAuthSlotId, type AuthSlotId } from '$lib/auth-slots';

export type AuthFlowPurpose = 'add-profile' | 'reauthenticate';

export const AUTH_CALLBACK_PATH = '/api/auth/callback' as const;
export const AUTH_FLOW_LIFETIME_MS = 10 * 60 * 1000;

const AUTH_FLOW_VERSION = 'v1';
const AUTH_FLOW_AAD = new TextEncoder().encode('maal:auth-flow:v1');

export interface AuthFlow {
	readonly schemaVersion: 1;
	readonly authSlotId: AuthSlotId;
	readonly purpose: AuthFlowPurpose;
	readonly expectedUserId: string | null;
	readonly returnTo: string;
	readonly nonce: string;
	readonly issuedAt: string;
	readonly expiresAt: string;
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

export async function sealAuthFlow(
	flow: AuthFlow,
	secret: string,
	randomValues: (bytes: Uint8Array<ArrayBuffer>) => void = fillRandomValues
) {
	const iv = new Uint8Array(12);
	randomValues(iv);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: AUTH_FLOW_AAD },
		await flowKey(secret),
		new TextEncoder().encode(JSON.stringify(flow))
	);
	return `${AUTH_FLOW_VERSION}.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openAuthFlow(
	value: string | null | undefined,
	secret: string,
	now = new Date()
): Promise<AuthFlow | null> {
	if (!value) return null;
	const [version, encodedIv, encodedCiphertext, extra] = value.split('.');
	if (version !== AUTH_FLOW_VERSION || !encodedIv || !encodedCiphertext || extra) return null;

	try {
		const plaintext = await crypto.subtle.decrypt(
		{
				name: 'AES-GCM',
				iv: decodeBase64Url(encodedIv),
				additionalData: AUTH_FLOW_AAD
			},
			await flowKey(secret),
			decodeBase64Url(encodedCiphertext)
		);
		const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<AuthFlow>;
		return validAuthFlow(parsed, now) ? parsed : null;
	} catch {
		return null;
	}
}

export function safeReturnTo(value: string | null) {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
	return value;
}

export function callbackUrl(origin: string) {
	return new URL(AUTH_CALLBACK_PATH, origin).toString();
}

function validAuthFlow(flow: Partial<AuthFlow>, now: Date): flow is AuthFlow {
	if (
		flow.schemaVersion !== 1 ||
		typeof flow.authSlotId !== 'string' ||
		!isAuthSlotId(flow.authSlotId) ||
		(flow.purpose !== 'add-profile' && flow.purpose !== 'reauthenticate') ||
		(flow.expectedUserId !== null && typeof flow.expectedUserId !== 'string') ||
		typeof flow.returnTo !== 'string' ||
		safeReturnTo(flow.returnTo) !== flow.returnTo ||
		typeof flow.nonce !== 'string' ||
		!isAuthSlotId(flow.nonce) ||
		typeof flow.issuedAt !== 'string' ||
		typeof flow.expiresAt !== 'string'
	) {
		return false;
	}

	const issuedAt = Date.parse(flow.issuedAt);
	const expiresAt = Date.parse(flow.expiresAt);
	return (
		Number.isFinite(issuedAt) &&
		Number.isFinite(expiresAt) &&
		expiresAt > issuedAt &&
		expiresAt - issuedAt <= AUTH_FLOW_LIFETIME_MS &&
		now.getTime() >= issuedAt - 60_000 &&
		now.getTime() < expiresAt
	);
}

async function flowKey(secret: string) {
	const material = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`maal:auth-flow:v1:${secret}`)
	);
	return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function fillRandomValues(bytes: Uint8Array<ArrayBuffer>) {
	crypto.getRandomValues(bytes);
}

function encodeBase64Url(bytes: Uint8Array) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(value: string) {
	const normalized = value
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(Math.ceil(value.length / 4) * 4, '=');
	return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

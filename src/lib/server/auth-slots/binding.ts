export async function sealSlotIdentity(userId: string, secret: string) {
	const encodedUserId = encodeBase64Url(new TextEncoder().encode(userId));
	const signature = await sign(encodedUserId, secret);
	return `${encodedUserId}.${signature}`;
}

export async function openSlotIdentity(value: string | undefined, secret: string) {
	if (!value) return null;
	const [encodedUserId, suppliedSignature, extra] = value.split('.');
	if (!encodedUserId || !suppliedSignature || extra) return null;
	const expectedSignature = await sign(encodedUserId, secret);
	if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

	try {
		return new TextDecoder().decode(decodeBase64Url(encodedUserId));
	} catch {
		return null;
	}
}

async function sign(value: string, secret: string) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return encodeBase64Url(
		new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
	);
}

function constantTimeEqual(left: string, right: string) {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
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

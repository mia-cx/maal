import { error } from '@sveltejs/kit';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	Object.getPrototypeOf(value) === Object.prototype;

export const readJsonObject = async (request: Request): Promise<Record<string, unknown>> => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}

	if (!isRecord(body)) error(400, { message: 'Invalid request.' });
	return body;
};

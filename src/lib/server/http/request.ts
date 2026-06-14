import { error } from '@sveltejs/kit';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

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

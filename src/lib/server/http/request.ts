import { error } from '@sveltejs/kit';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	Object.getPrototypeOf(value) === Object.prototype;

const contentType = (request: Request) =>
	request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();

export const readJsonObject = async (
	request: Request,
	options: { onParseError?: (cause: unknown) => void } = {}
): Promise<Record<string, unknown>> => {
	if (contentType(request) !== 'application/json') {
		error(415, { message: 'Expected application/json request body.' });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch (cause) {
		try {
			options.onParseError?.(cause);
		} catch {
			// Ignore parse-error hook failures to preserve the HTTP contract.
		}
		error(400, { message: 'Invalid request.' });
	}

	if (!isRecord(body)) error(400, { message: 'Expected a JSON object request body.' });
	return body;
};

export const readFormData = async (request: Request): Promise<FormData> => {
	const type = contentType(request);
	if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data') {
		error(415, { message: 'Expected form request body.' });
	}

	try {
		return await request.formData();
	} catch {
		error(400, { message: 'Malformed form request body.' });
	}
};

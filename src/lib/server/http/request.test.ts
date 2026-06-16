import { describe, expect, it } from 'vitest';
import { readJsonObject } from './request';

const jsonRequest = (body: string) =>
	new Request('https://maal.test', {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/json' }
	});

describe('readJsonObject', () => {
	it('returns object JSON bodies', async () => {
		await expect(readJsonObject(jsonRequest('{"name":"Maal"}'))).resolves.toEqual({ name: 'Maal' });
	});

	it('rejects invalid JSON', async () => {
		await expect(readJsonObject(jsonRequest('{'))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Invalid request.' }
		});
	});

	it('rejects primitive JSON', async () => {
		await expect(readJsonObject(jsonRequest('"not an object"'))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Invalid request.' }
		});
	});
});

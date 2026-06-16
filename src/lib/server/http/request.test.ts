import { describe, expect, it } from 'vitest';
import { readFormData, readJsonObject } from './request';

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

	it('rejects unsupported JSON content types', async () => {
		await expect(readJsonObject(new Request('https://maal.test'))).rejects.toMatchObject({
			status: 415,
			body: { message: 'Expected application/json request body.' }
		});
	});

	it('rejects invalid JSON', async () => {
		await expect(readJsonObject(jsonRequest('{'))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Malformed JSON request body.' }
		});
	});

	it('rejects primitive JSON', async () => {
		await expect(readJsonObject(jsonRequest('"not an object"'))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Expected a JSON object request body.' }
		});
	});

	it('rejects array JSON', async () => {
		await expect(readJsonObject(jsonRequest('[{"name":"Maal"}]'))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Expected a JSON object request body.' }
		});
	});
});

describe('readFormData', () => {
	it('returns form request bodies', async () => {
		const request = new Request('https://maal.test', {
			method: 'POST',
			body: new URLSearchParams({ priceId: 'price_123' }),
			headers: { 'content-type': 'application/x-www-form-urlencoded' }
		});

		await expect(readFormData(request)).resolves.toMatchObject({});
	});

	it('rejects unsupported form content types', async () => {
		await expect(readFormData(jsonRequest('{"priceId":"price_123"}'))).rejects.toMatchObject({
			status: 415,
			body: { message: 'Expected form request body.' }
		});
	});
});

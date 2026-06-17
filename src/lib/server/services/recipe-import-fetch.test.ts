import { describe, expect, it, vi } from 'vitest';
import {
	assertRecipeImportUrlForTest,
	fetchRecipeImportPage,
	RecipeImportFetchError
} from './recipe-import-fetch';

const expectBlocked = (url: string) =>
	expect(() => assertRecipeImportUrlForTest(url)).toThrow(
		'Recipe URL must point to a public website.'
	);

describe('recipe import fetch boundary', () => {
	it('rejects non-HTTP URLs', () => {
		expect(() => assertRecipeImportUrlForTest('file:///etc/passwd')).toThrow('Invalid recipe URL.');
	});

	it('rejects URLs over the configured import length', () => {
		expect(() => assertRecipeImportUrlForTest('https://example.com/recipe', 10)).toThrow(
			'Recipe URL is too long.'
		);
	});

	it('rejects loopback, private, link-local, reserved, and single-label hosts', () => {
		for (const url of [
			'http://localhost/recipe',
			'http://app.localhost/recipe',
			'http://127.0.0.1/recipe',
			'http://10.0.0.1/recipe',
			'http://172.16.0.1/recipe',
			'http://192.168.1.1/recipe',
			'http://169.254.169.254/latest/meta-data',
			'http://192.0.2.1/recipe',
			'http://198.51.100.1/recipe',
			'http://203.0.113.1/recipe',
			'http://kitchen/recipe',
			'http://printer.local/recipe',
			'http://[::1]/recipe',
			'http://[0:0:0:0:0:0:0:1]/recipe',
			'http://[::ffff:127.0.0.1]/recipe',
			'http://[0:0:0:0:0:ffff:7f00:1]/recipe',
			'http://[0:0:0:0:0:ffff:a9fe:a9fe]/recipe',
			'http://[fd00::1]/recipe',
			'http://[fe80::1]/recipe'
		]) {
			expectBlocked(url);
		}
	});

	it('allows public-looking recipe hosts at parse time', () => {
		expect(assertRecipeImportUrlForTest('https://example.com/recipe').hostname).toBe('example.com');
		expect(assertRecipeImportUrlForTest('http://93.184.216.34/recipe').hostname).toBe(
			'93.184.216.34'
		);
	});

	it('fetches public DNS recipe hosts', async () => {
		const fetcher = vi.fn(async () => new Response('<html>recipe</html>', { status: 200 }));

		await expect(
			fetchRecipeImportPage('https://example.com/recipe', 1000, { fetcher })
		).resolves.toEqual({
			html: '<html>recipe</html>',
			finalUrl: 'https://example.com/recipe'
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('allows redirects to validated public DNS hostnames', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				new Response('', { status: 302, headers: { location: 'https://example.com/admin' } })
			)
			.mockResolvedValueOnce(
				new Response('<html>recipe</html>', { status: 200 })
			) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('http://93.184.216.34/recipe', 1000, { fetcher })
		).resolves.toEqual({
			html: '<html>recipe</html>',
			finalUrl: 'https://example.com/admin'
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('rejects redirects to private hosts before following them', async () => {
		const fetcher = vi.fn(
			async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
		) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('http://93.184.216.34/recipe', 1000, { fetcher })
		).rejects.toThrow('Recipe URL must point to a public website.');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('rejects pages larger than the import limit', async () => {
		const fetcher = vi.fn(
			async () => new Response('too large', { status: 200, headers: { 'content-length': '9' } })
		) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('http://93.184.216.34/recipe', 8, { fetcher })
		).rejects.toThrow('Recipe page is too large.');
	});

	it('returns the final URL after a validated redirect', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				new Response('', { status: 301, headers: { location: 'http://93.184.216.35/cards' } })
			)
			.mockResolvedValueOnce(
				new Response('<html>recipe</html>', { status: 200 })
			) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('http://93.184.216.34/recipe', 1000, { fetcher })
		).resolves.toEqual({
			html: '<html>recipe</html>',
			finalUrl: 'http://93.184.216.35/cards'
		});
	});

	it('uses a typed fetch error for failed responses', async () => {
		const fetcher = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('http://93.184.216.34/missing', 1000, { fetcher })
		).rejects.toBeInstanceOf(RecipeImportFetchError);
	});
});

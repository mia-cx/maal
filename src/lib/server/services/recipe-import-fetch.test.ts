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

	it('rejects loopback, private, link-local, and single-label hosts', () => {
		for (const url of [
			'http://localhost/recipe',
			'http://app.localhost/recipe',
			'http://127.0.0.1/recipe',
			'http://10.0.0.1/recipe',
			'http://172.16.0.1/recipe',
			'http://192.168.1.1/recipe',
			'http://169.254.169.254/latest/meta-data',
			'http://kitchen/recipe',
			'http://printer.local/recipe',
			'http://[::1]/recipe',
			'http://[fd00::1]/recipe'
		]) {
			expectBlocked(url);
		}
	});

	it('allows public HTTP and HTTPS recipe hosts', () => {
		expect(assertRecipeImportUrlForTest('https://example.com/recipe').hostname).toBe('example.com');
		expect(assertRecipeImportUrlForTest('http://203.0.114.10/recipe').hostname).toBe(
			'203.0.114.10'
		);
	});

	it('rejects redirects to private hosts before following them', async () => {
		const fetcher = vi.fn(
			async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
		) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('https://example.com/recipe', 1000, fetcher)
		).rejects.toThrow('Recipe URL must point to a public website.');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('rejects pages larger than the import limit', async () => {
		const fetcher = vi.fn(
			async () => new Response('too large', { status: 200, headers: { 'content-length': '9' } })
		) as unknown as typeof fetch;

		await expect(fetchRecipeImportPage('https://example.com/recipe', 8, fetcher)).rejects.toThrow(
			'Recipe page is too large.'
		);
	});

	it('returns the final URL after a validated redirect', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				new Response('', { status: 301, headers: { location: 'https://recipes.example/cards' } })
			)
			.mockResolvedValueOnce(
				new Response('<html>recipe</html>', { status: 200 })
			) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('https://example.com/recipe', 1000, fetcher)
		).resolves.toEqual({
			html: '<html>recipe</html>',
			finalUrl: 'https://recipes.example/cards'
		});
	});

	it('uses a typed fetch error for failed responses', async () => {
		const fetcher = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

		await expect(
			fetchRecipeImportPage('https://example.com/missing', 1000, fetcher)
		).rejects.toBeInstanceOf(RecipeImportFetchError);
	});
});

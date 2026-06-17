import { describe, expect, it, vi } from 'vitest';
import { fetchRecipeFromUrlForImport } from './recipe-import';

const recipeJsonLd = JSON.stringify({
	'@context': 'https://schema.org',
	'@type': 'Recipe',
	name: 'Test Recipe',
	recipeIngredient: ['1 cup flour'],
	recipeInstructions: ['Mix it']
});

const recipePage = `<html><head><script type="application/ld+json">${recipeJsonLd}</script></head></html>`;

const okRecipeResponse = () =>
	new Response(recipePage, {
		status: 200,
		headers: { 'content-type': 'text/html' }
	});

describe('fetchRecipeFromUrlForImport', () => {
	it('fails closed for DNS hosts unless a safe runtime is explicit', async () => {
		const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(okRecipeResponse()));

		await expect(
			fetchRecipeFromUrlForImport('https://example.com/recipe', { fetcher })
		).rejects.toThrow('Recipe URL host cannot be fetched safely in this runtime.');
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('imports DNS-hosted recipes when the caller opts into Cloudflare Workers runtime', async () => {
		const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(okRecipeResponse()));

		const recipe = await fetchRecipeFromUrlForImport('https://example.com/recipe', {
			fetcher,
			runtime: 'cloudflare-workers'
		});

		expect(recipe.title).toBe('Test Recipe');
		expect(recipe.sourceUrl).toBe('https://example.com/recipe');
		expect(fetcher).toHaveBeenCalledOnce();
	});
});

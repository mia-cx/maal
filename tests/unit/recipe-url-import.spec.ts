import type { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { RecipeImportedCandidateSchema } from '$lib/domain/recipes/schema.js';
import { Schema } from 'effect';
import {
	MAX_RECIPE_IMPORT_BYTES,
	RecipeImportFetchError,
	assertPublicRecipeUrl,
	fetchRecipePage
} from '$lib/server/recipe-import/fetch.js';
import { fetchRecipeCandidate, parseRecipeCandidate } from '$lib/server/recipe-import/parser.js';
import {
	authorizeBrowserRecipeImport,
	consumeRecipeImportLimit
} from '$lib/server/recipe-import/remote-compute.js';

import {
	MCP_TEST_HOUSEHOLD,
	MCP_TEST_NOW,
	MCP_TEST_USER,
	createMcpTestDatabase,
	seedMcpHousehold
} from './mcp-test-helpers.js';

const recipeHtml = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Tomato soup",
  "description": "A &amp; bright soup",
  "image": ["https://cdn.example/soup.jpg"],
  "prepTime": "PT10M",
  "cookTime": "PT25M",
  "totalTime": "PT35M",
  "recipeYield": "4 servings",
  "author": {"name": "Alice"},
  "publisher": {"name": "Recipes Inc"},
  "recipeIngredient": ["2 tomatoes", "salt, optional"],
  "recipeInstructions": [
    {"@type": "HowToStep", "text": "Chop tomatoes."},
    {"@type": "HowToStep", "text": "Simmer for 25 minutes."}
  ],
  "recipeCategory": "Soup",
  "recipeCuisine": "Dutch"
}
</script></head></html>`;

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
	({ miniflare, database } = await createMcpTestDatabase());
	await seedMcpHousehold(database);
});

afterEach(async () => {
	await miniflare.dispose();
});

describe('recipe URL fetch safety', () => {
	test.each([
		'file:///etc/passwd',
		'http://localhost/recipe',
		'http://127.0.0.1/recipe',
		'http://10.0.0.1/recipe',
		'http://169.254.169.254/latest/meta-data',
		'http://192.168.1.2/recipe',
		'http://[::1]/recipe',
		'http://service.internal/recipe',
		'http://singlelabel/recipe'
	])('blocks non-public URL %s', (url) => {
		expect(() => assertPublicRecipeUrl(url)).toThrow(RecipeImportFetchError);
	});

	test('checks every redirect before fetching it and caps redirects at three', async () => {
		const privateRedirect = vi.fn(
			async () =>
				new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
		);
		await expect(
			fetchRecipePage('https://recipes.example/start', { fetcher: privateRedirect })
		).rejects.toMatchObject({ code: 'private_host' });
		expect(privateRedirect).toHaveBeenCalledOnce();

		const redirectLoop = vi.fn(
			async () => new Response(null, { status: 302, headers: { location: '/again' } })
		);
		await expect(
			fetchRecipePage('https://recipes.example/start', { fetcher: redirectLoop })
		).rejects.toMatchObject({ code: 'too_many_redirects' });
		expect(redirectLoop).toHaveBeenCalledTimes(4);
	});

	test('enforces the timeout and 1.5 MB response cap', async () => {
		const hangingFetch: typeof fetch = async (_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
			});
		await expect(
			fetchRecipePage('https://recipes.example/slow', { fetcher: hangingFetch, timeoutMs: 1 })
		).rejects.toMatchObject({ code: 'timeout' });

		await expect(
			fetchRecipePage('https://recipes.example/huge', {
				fetcher: async () =>
					new Response('small', {
						headers: { 'content-length': String(MAX_RECIPE_IMPORT_BYTES + 1) }
					})
			})
		).rejects.toMatchObject({ code: 'response_too_large' });
	});
});

describe('recipe URL candidate boundary', () => {
	test('extracts JSON-LD provenance and re-decodes the complete Effect candidate', async () => {
		const candidate = await parseRecipeCandidate({
			html: recipeHtml,
			finalUrl: 'https://recipes.example/tomato-soup',
			now: MCP_TEST_NOW
		});
		expect(Schema.decodeUnknownSync(RecipeImportedCandidateSchema)(candidate)).toMatchObject({
			title: 'Tomato soup',
			description: 'A & bright soup',
			imageUrl: 'https://cdn.example/soup.jpg',
			prepTimeMinutes: 10,
			cookTimeMinutes: 25,
			totalTimeMinutes: 35,
			yield: 4,
			sourceUrl: 'https://recipes.example/tomato-soup',
			sourceSiteName: 'recipes.example',
			sourceAuthorName: 'Alice',
			sourcePublisherName: 'Recipes Inc',
			sourceImportedAt: MCP_TEST_NOW
		});
		expect(candidate.sourceHtmlHash).toMatch(/^[a-f0-9]{64}$/);
		expect(candidate.ingredients.map(({ originalText }) => originalText)).toEqual([
			'2 tomatoes',
			'salt, optional'
		]);
		expect(candidate.instructions.map(({ text }) => text)).toEqual([
			'Chop tomatoes.',
			'Simmer for 25 minutes.'
		]);
	});

	test('authorizes and rate-limits before fetch while leaving D1 content untouched', async () => {
		const counts = async () =>
			Promise.all(
				['recipes', 'meals', 'sync_changes'].map(async (table) =>
					Number(
						(
							await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
								count: number;
							}>()
						)?.count ?? 0
					)
				)
			);
		const before = await counts();
		await authorizeBrowserRecipeImport({
			database,
			actor: {
				authSlotId: 'slot_alice',
				workosUserId: MCP_TEST_USER,
				activeOrganizationIds: [MCP_TEST_HOUSEHOLD],
				activeMemberships: [
					{
						membershipId: `membership_${MCP_TEST_HOUSEHOLD}`,
						householdId: MCP_TEST_HOUSEHOLD,
						householdName: 'Family',
						roleSlug: 'admin',
						permissions: ['meals:write']
					}
				]
			},
			householdId: MCP_TEST_HOUSEHOLD,
			now: MCP_TEST_NOW
		});
		const limit = vi.fn(async () => ({ success: true }));
		await consumeRecipeImportLimit({
			limiter: { limit },
			workosUserId: MCP_TEST_USER,
			householdId: MCP_TEST_HOUSEHOLD
		});
		const candidate = await fetchRecipeCandidate('https://recipes.example/tomato-soup', {
			fetcher: async () => new Response(recipeHtml)
		});
		expect(candidate.title).toBe('Tomato soup');
		expect(limit).toHaveBeenCalledWith({
			key: `recipe-url:${MCP_TEST_USER}:${MCP_TEST_HOUSEHOLD}`
		});
		expect(await counts()).toEqual(before);
	});

	test('rejects before network work when plan access or the limiter denies', async () => {
		await database.prepare("UPDATE billing_subscriptions SET status = 'canceled'").run();
		await expect(
			authorizeBrowserRecipeImport({
				database,
				actor: {
					authSlotId: 'slot_alice',
					workosUserId: MCP_TEST_USER,
					activeOrganizationIds: [MCP_TEST_HOUSEHOLD],
					activeMemberships: [
						{
							membershipId: `membership_${MCP_TEST_HOUSEHOLD}`,
							householdId: MCP_TEST_HOUSEHOLD,
							householdName: 'Family',
							roleSlug: 'admin',
							permissions: ['meals:write']
						}
					]
				},
				householdId: MCP_TEST_HOUSEHOLD,
				now: MCP_TEST_NOW
			})
		).rejects.toMatchObject({ _tag: 'SyncCapabilityDenied' });
		await expect(
			consumeRecipeImportLimit({
				limiter: { limit: async () => ({ success: false }) },
				workosUserId: MCP_TEST_USER,
				householdId: MCP_TEST_HOUSEHOLD
			})
		).rejects.toMatchObject({ _tag: 'RemoteComputeRateLimited' });
	});
});

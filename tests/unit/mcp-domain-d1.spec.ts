import type { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	D1RemoteDomainPort,
	allMealConflictGroups,
	allRecipeConflictGroups,
	cloneRecipeAsMeal,
	createRecipeAggregate
} from '$lib/server/domain/remote-port.js';
import { candidateFromToolRecipe } from '$lib/server/mcp/builders.js';
import { D1HouseholdSyncRepository } from '$lib/server/sync/household-d1-repository.js';
import { D1UserSyncRepository } from '$lib/server/sync/d1-repository.js';

import {
	MCP_TEST_HOUSEHOLD,
	MCP_TEST_USER,
	createMcpTestDatabase,
	seedMcpHousehold
} from './mcp-test-helpers.js';

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
	({ miniflare, database } = await createMcpTestDatabase());
	await seedMcpHousehold(database);
});

afterEach(async () => {
	await miniflare.dispose();
});

describe('shared remote D1 domain port', () => {
	test('writes the same normalized recipe and meal state exposed by sync bootstrap', async () => {
		const port = new D1RemoteDomainPort(database);
		const recipe = createRecipeAggregate({
			ownerUserId: MCP_TEST_USER,
			candidate: candidateFromToolRecipe({
				title: 'Shared soup',
				ingredients: ['1 onion'],
				instructions: ['Simmer.']
			})
		});
		const writtenRecipe = await port.writeUserRecipe({
			actorUserId: MCP_TEST_USER,
			aggregate: recipe,
			conflictGroups: allRecipeConflictGroups,
			operation: 'upsert'
		});
		const userBootstrap = await new D1UserSyncRepository(database).bootstrap(MCP_TEST_USER);
		expect(userBootstrap.aggregates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					entityKind: 'recipe',
					entityId: writtenRecipe.id,
					aggregate: expect.objectContaining({ title: 'Shared soup' })
				})
			])
		);

		const meal = cloneRecipeAsMeal({
			recipe: writtenRecipe,
			householdId: MCP_TEST_HOUSEHOLD,
			date: '2026-08-24'
		});
		const writtenMeal = await port.writeHouseholdMeal({
			actorUserId: MCP_TEST_USER,
			householdId: MCP_TEST_HOUSEHOLD,
			aggregate: meal,
			conflictGroups: allMealConflictGroups,
			operation: 'upsert'
		});
		const householdBootstrap = await new D1HouseholdSyncRepository(database).bootstrap(
			MCP_TEST_HOUSEHOLD
		);
		expect(householdBootstrap.aggregates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					entityKind: 'meal',
					entityId: writtenMeal.id,
					aggregate: expect.objectContaining({
						householdId: MCP_TEST_HOUSEHOLD,
						title: 'Shared soup'
					})
				})
			])
		);
	});

	test('reads only active normalized households', async () => {
		const port = new D1RemoteDomainPort(database);
		await expect(port.listHouseholds([MCP_TEST_HOUSEHOLD])).resolves.toEqual([
			{
				id: MCP_TEST_HOUSEHOLD,
				name: MCP_TEST_HOUSEHOLD,
				locale: 'en-US',
				timezone: null
			}
		]);
		await database
			.prepare('UPDATE households SET deleted_at = ? WHERE household_id = ?')
			.bind('2026-08-22T12:00:00.000Z', MCP_TEST_HOUSEHOLD)
			.run();
		await expect(port.listHouseholds([MCP_TEST_HOUSEHOLD])).resolves.toEqual([]);
	});
});

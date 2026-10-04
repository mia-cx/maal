import type { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	D1RemoteDomainPort,
	allMealConflictGroups,
	allRecipeConflictGroups,
	cloneRecipeAsMeal,
	createRecipeAggregate
} from '$lib/server/domain/remote-port.js';
import { candidateFromToolRecipe, makeCheckIn } from '$lib/server/mcp/builders.js';
import { D1HouseholdSyncRepository } from '$lib/server/sync/household-d1-repository.js';
import { D1UserSyncRepository } from '$lib/server/sync/d1-repository.js';

import {
	MCP_TEST_HOUSEHOLD,
	MCP_TEST_USER,
	createMcpTestDatabase,
	seedMcpHousehold
} from './mcp-test-helpers.js';

const FIRST_PAGE = { afterEntityKey: null, limit: 100, manifest: [] };
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
		const userBootstrap = await new D1UserSyncRepository(database).bootstrap(
			MCP_TEST_USER,
			FIRST_PAGE
		);
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
			MCP_TEST_HOUSEHOLD,
			FIRST_PAGE
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

		const checkIn = makeCheckIn({
			existing: null,
			mealId: writtenMeal.id,
			reporterUserId: MCP_TEST_USER,
			verdict: 'repeat',
			cookTimeMinutes: 25,
			reason: 'Easy weeknight dinner'
		});
		await port.writeMealCheckIn({
			actorUserId: MCP_TEST_USER,
			householdId: MCP_TEST_HOUSEHOLD,
			aggregate: checkIn
		});
		await expect(port.listMealCheckIns(MCP_TEST_HOUSEHOLD, writtenMeal.id)).resolves.toEqual([
			expect.objectContaining({ id: checkIn.id, verdict: 'repeat' })
		]);

		const now = '2026-08-22T12:00:00.000Z';
		const foodId = '0198d3bc-e600-7000-8000-000000000000';
		await database
			.prepare(
				'INSERT INTO foods (id, default_measure_unit_id, default_measure_base_unit_id) VALUES (?, ?, ?)'
			)
			.bind(foodId, 'each', 'each')
			.run();
		const preference = await port.writeUserFoodPreference({
			actorUserId: MCP_TEST_USER,
			aggregate: {
				id: '0198d3bc-e600-7000-8000-000000000001',
				workosUserId: MCP_TEST_USER,
				foodId,
				preference: 'like',
				reason: null,
				schemaVersion: 1,
				revision: 0,
				createdAt: now,
				updatedAt: now,
				deletedAt: null,
				conflictClocks: {}
			}
		});
		await expect(port.getUserFoodProfile(MCP_TEST_USER)).resolves.toMatchObject({
			userFoodPreferences: [expect.objectContaining({ id: preference.id, foodId })]
		});
	});

	test('returns the committed aggregate when the write batch throws after committing', async () => {
		const port = new D1RemoteDomainPort(database);
		const meal = await port.writeHouseholdMeal({
			actorUserId: MCP_TEST_USER,
			householdId: MCP_TEST_HOUSEHOLD,
			aggregate: cloneRecipeAsMeal({
				recipe: await port.writeUserRecipe({
					actorUserId: MCP_TEST_USER,
					aggregate: createRecipeAggregate({
						ownerUserId: MCP_TEST_USER,
						candidate: candidateFromToolRecipe({
							title: 'Race soup',
							ingredients: ['1 onion'],
							instructions: ['Simmer.']
						})
					}),
					conflictGroups: allRecipeConflictGroups,
					operation: 'upsert'
				}),
				householdId: MCP_TEST_HOUSEHOLD,
				date: '2026-08-24'
			}),
			conflictGroups: allMealConflictGroups,
			operation: 'upsert'
		});
		const checkIn = makeCheckIn({
			existing: null,
			mealId: meal.id,
			reporterUserId: MCP_TEST_USER,
			verdict: 'repeat',
			cookTimeMinutes: 20,
			reason: 'Committed, then the connection dropped'
		});
		let failed = false;
		const flaky: D1Database = new Proxy(database, {
			get(target, property) {
				if (property !== 'batch') {
					const value = Reflect.get(target, property);
					return typeof value === 'function' ? value.bind(target) : value;
				}
				return async (statements: D1PreparedStatement[]) => {
					const result = await target.batch(statements);
					if (!failed) {
						failed = true;
						throw new Error('batch committed, then the response was lost');
					}
					return result;
				};
			}
		});
		const flakyPort = new D1RemoteDomainPort(flaky);
		await expect(
			flakyPort.writeMealCheckIn({
				actorUserId: MCP_TEST_USER,
				householdId: MCP_TEST_HOUSEHOLD,
				aggregate: checkIn
			})
		).resolves.toMatchObject({ id: checkIn.id, mealId: meal.id, verdict: 'repeat' });
		await expect(port.listMealCheckIns(MCP_TEST_HOUSEHOLD, meal.id)).resolves.toEqual([
			expect.objectContaining({ id: checkIn.id })
		]);
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

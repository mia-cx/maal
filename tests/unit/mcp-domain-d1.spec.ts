import type { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';

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

	test('does not return a check-in moved to another meal between the ID listing and the aggregate read', async () => {
		const port = new D1RemoteDomainPort(database);
		const recipe = await port.writeUserRecipe({
			actorUserId: MCP_TEST_USER,
			aggregate: createRecipeAggregate({
				ownerUserId: MCP_TEST_USER,
				candidate: candidateFromToolRecipe({
					title: 'Moved soup',
					ingredients: ['1 onion'],
					instructions: ['Simmer.']
				})
			}),
			conflictGroups: allRecipeConflictGroups,
			operation: 'upsert'
		});
		const writeMeal = () =>
			port.writeHouseholdMeal({
				actorUserId: MCP_TEST_USER,
				householdId: MCP_TEST_HOUSEHOLD,
				aggregate: cloneRecipeAsMeal({
					recipe,
					householdId: MCP_TEST_HOUSEHOLD,
					date: '2026-08-24',
					mealId: uuidv7()
				}),
				conflictGroups: allMealConflictGroups,
				operation: 'upsert'
			});
		const mealA = await writeMeal();
		const mealB = await writeMeal();
		const checkIn = makeCheckIn({
			existing: null,
			mealId: mealA.id,
			reporterUserId: MCP_TEST_USER,
			verdict: 'repeat',
			cookTimeMinutes: 20,
			reason: 'Moved mid-read'
		});
		await port.writeMealCheckIn({
			actorUserId: MCP_TEST_USER,
			householdId: MCP_TEST_HOUSEHOLD,
			aggregate: checkIn
		});
		const concurrent = new D1HouseholdSyncRepository(database);
		let moved = false;
		const intercepted: D1Database = new Proxy(database, {
			get(target, property) {
				if (property !== 'prepare') {
					const value = Reflect.get(target, property);
					return typeof value === 'function' ? value.bind(target) : value;
				}
				return (sql: string) => {
					const statement = target.prepare(sql);
					if (!sql.startsWith('SELECT id FROM meal_check_ins')) return statement;
					return new Proxy(statement, {
						get(inner, innerProperty) {
							if (innerProperty !== 'bind') {
								const value = Reflect.get(inner, innerProperty);
								return typeof value === 'function' ? value.bind(inner) : value;
							}
							return (...args: unknown[]) => {
								const bound = (inner.bind as (...a: unknown[]) => D1PreparedStatement)(...args);
								return new Proxy(bound, {
									get(boundTarget, boundProperty) {
										if (boundProperty !== 'all') {
											const value = Reflect.get(boundTarget, boundProperty);
											return typeof value === 'function' ? value.bind(boundTarget) : value;
										}
										return async () => {
											const result = await bound.all();
											if (!moved) {
												moved = true;
												await concurrent.commitWithResult({
													householdId: MCP_TEST_HOUSEHOLD,
													actorUserId: MCP_TEST_USER,
													deviceId: uuidv7(),
													mutation: {
														schemaVersion: CURRENT_SCHEMA_VERSION,
														mutationId: uuidv7(),
														originDeviceId: uuidv7(),
														entityKind: 'meal_check_in',
														entityId: checkIn.id,
														conflictGroups: ['response'],
														operation: 'upsert',
														occurredAt: '2026-08-25T12:00:00.000Z',
														aggregate: { ...checkIn, mealId: mealB.id }
													},
													mode: 'live',
													receivedAt: '2026-08-25T12:00:00.000Z'
												});
											}
											return result;
										};
									}
								});
							};
						}
					});
				};
			}
		});
		const interceptedPort = new D1RemoteDomainPort(intercepted);
		await expect(
			interceptedPort.getMealCheckIn(MCP_TEST_HOUSEHOLD, mealA.id, MCP_TEST_USER)
		).resolves.toBeNull();
		await expect(interceptedPort.listMealCheckIns(MCP_TEST_HOUSEHOLD, mealA.id)).resolves.toEqual(
			[]
		);
		await expect(
			port.getMealCheckIn(MCP_TEST_HOUSEHOLD, mealB.id, MCP_TEST_USER)
		).resolves.toMatchObject({ id: checkIn.id });
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

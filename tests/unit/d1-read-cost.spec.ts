import type { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	CURRENT_PROTOCOL_VERSION,
	CURRENT_SCHEMA_VERSION
} from '$lib/domain/contracts/versions.js';
import type { MealAggregate } from '$lib/domain/meals/schema.js';
import type { RecipeAggregate } from '$lib/domain/recipes/schema.js';
import {
	D1RemoteDomainPort,
	allMealConflictGroups,
	allRecipeConflictGroups,
	cloneRecipeAsMeal,
	createRecipeAggregate
} from '$lib/server/domain/remote-port.js';
import { candidateFromToolRecipe, makeCheckIn } from '$lib/server/mcp/builders.js';
import { D1HouseholdSyncRepository } from '$lib/server/sync/household-d1-repository.js';
import { bootstrapHouseholdSync } from '$lib/server/sync/household-service.js';
import { D1UserSyncRepository } from '$lib/server/sync/d1-repository.js';
import { bootstrapUserSync } from '$lib/server/sync/service.js';

import {
	MCP_TEST_HOUSEHOLD,
	MCP_TEST_USER,
	createMcpTestDatabase,
	seedMcpHousehold
} from './mcp-test-helpers.js';

/** The most D1 statements one read, one write (batch included), or one bootstrap page may prepare. */
const MAX_STATEMENTS_PER_OPERATION = 40;
/** Seeding 40 aggregates through Miniflare takes several seconds on its own. */
const SEEDED_TEST_TIMEOUT_MS = 60_000;

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
	({ miniflare, database } = await createMcpTestDatabase());
	await seedMcpHousehold(database);
});

afterEach(async () => {
	await miniflare.dispose();
});

/** Wraps D1 so a test can count every statement prepared through it, batched or not. */
const counted = (target: D1Database) => {
	let statements = 0;
	const database = new Proxy(target, {
		get(object, property) {
			if (property === 'prepare') {
				return (sql: string) => {
					statements += 1;
					return object.prepare(sql);
				};
			}
			const value: unknown = Reflect.get(object, property);
			return typeof value === 'function' ? value.bind(object) : value;
		}
	});
	return {
		database,
		measure: async (run: () => Promise<unknown>) => {
			statements = 0;
			await run();
			return statements;
		}
	};
};

const recipe = (title: string): RecipeAggregate =>
	createRecipeAggregate({
		ownerUserId: MCP_TEST_USER,
		candidate: candidateFromToolRecipe({
			title,
			ingredients: ['1 onion', '2 carrots'],
			instructions: ['Chop.', 'Simmer.']
		})
	});

const commitMeal = (repository: D1HouseholdSyncRepository, meal: MealAggregate) => {
	const now = new Date().toISOString() as `${string}Z`;
	return repository.commit({
		householdId: MCP_TEST_HOUSEHOLD,
		actorUserId: MCP_TEST_USER,
		deviceId: uuidv7(),
		mutation: {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			mutationId: uuidv7(),
			originDeviceId: uuidv7(),
			entityKind: 'meal',
			entityId: meal.id,
			conflictGroups: [...allMealConflictGroups].filter((group) => group !== 'deletion') as [
				string,
				...string[]
			],
			operation: 'upsert',
			occurredAt: now,
			aggregate: meal
		},
		mode: 'live',
		receivedAt: now
	});
};

const seedMeals = async (count: number): Promise<MealAggregate[]> => {
	const repository = new D1HouseholdSyncRepository(database);
	const meals: MealAggregate[] = [];
	for (let index = 0; index < count; index += 1) {
		const meal = {
			...cloneRecipeAsMeal({
				recipe: recipe(`Soup ${index}`),
				householdId: MCP_TEST_HOUSEHOLD,
				date: '2026-08-24'
			}),
			sourceRecipeId: null
		};
		await commitMeal(repository, meal);
		meals.push(meal);
	}
	return meals;
};

const seedRecipes = async (count: number): Promise<RecipeAggregate[]> => {
	const repository = new D1UserSyncRepository(database);
	const recipes: RecipeAggregate[] = [];
	for (let index = 0; index < count; index += 1) {
		const aggregate = recipe(`Stew ${index}`);
		const now = new Date().toISOString() as `${string}Z`;
		await repository.commit({
			actorUserId: MCP_TEST_USER,
			deviceId: uuidv7(),
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: uuidv7(),
				entityKind: 'recipe',
				entityId: aggregate.id,
				conflictGroups: [...allRecipeConflictGroups].filter((group) => group !== 'deletion') as [
					string,
					...string[]
				],
				operation: 'upsert',
				occurredAt: now,
				aggregate
			},
			mode: 'live',
			receivedAt: now
		});
		recipes.push(aggregate);
	}
	return recipes;
};

/** Measures each household operation against the current dataset. */
const householdCosts = async (meals: readonly MealAggregate[]) => {
	const { database: countedDatabase, measure } = counted(database);
	const port = new D1RemoteDomainPort(countedDatabase);
	const target = meals[0]!;
	// The newest meal has no check-in yet, so each measurement creates one.
	const checkInTarget = meals.at(-1)!;
	const current = (await port.getHouseholdMeal(MCP_TEST_HOUSEHOLD, target.id))!;
	return {
		getMeal: await measure(() => port.getHouseholdMeal(MCP_TEST_HOUSEHOLD, target.id)),
		listMeals: await measure(() => port.listHouseholdMeals(MCP_TEST_HOUSEHOLD)),
		updateMeal: await measure(() =>
			port.writeHouseholdMeal({
				actorUserId: MCP_TEST_USER,
				householdId: MCP_TEST_HOUSEHOLD,
				aggregate: { ...current, title: `${current.title}!` },
				conflictGroups: ['header'],
				operation: 'upsert'
			})
		),
		checkIn: await measure(async () => {
			const existing = await port.getMealCheckIn(
				MCP_TEST_HOUSEHOLD,
				checkInTarget.id,
				MCP_TEST_USER
			);
			await port.writeMealCheckIn({
				actorUserId: MCP_TEST_USER,
				householdId: MCP_TEST_HOUSEHOLD,
				aggregate: makeCheckIn({
					existing,
					mealId: checkInTarget.id,
					reporterUserId: MCP_TEST_USER,
					verdict: 'repeat',
					cookTimeMinutes: null,
					reason: null
				})
			});
		}),
		bootstrapPage: await measure(() =>
			bootstrapHouseholdSync(new D1HouseholdSyncRepository(countedDatabase), MCP_TEST_HOUSEHOLD, {
				protocolVersion: CURRENT_PROTOCOL_VERSION,
				deviceId: uuidv7(),
				audience: { kind: 'household', id: MCP_TEST_HOUSEHOLD },
				manifest: meals.map(({ id, updatedAt }) => ({
					entityKind: 'meal' as const,
					entityId: id,
					revision: 1,
					updatedAt,
					previousServerAck: true
				})),
				afterEntityKey: null,
				limit: 5
			})
		)
	};
};

const userCosts = async (recipes: readonly RecipeAggregate[]) => {
	const { database: countedDatabase, measure } = counted(database);
	const port = new D1RemoteDomainPort(countedDatabase);
	const target = (await port.getUserRecipe(MCP_TEST_USER, recipes[0]!.id))!;
	return {
		getRecipe: await measure(() => port.getUserRecipe(MCP_TEST_USER, target.id)),
		listRecipes: await measure(() => port.listUserRecipes(MCP_TEST_USER)),
		updateRecipe: await measure(() =>
			port.writeUserRecipe({
				actorUserId: MCP_TEST_USER,
				aggregate: { ...target, title: `${target.title}!` },
				conflictGroups: ['header'],
				operation: 'upsert'
			})
		),
		bootstrapPage: await measure(() =>
			bootstrapUserSync(new D1UserSyncRepository(countedDatabase), MCP_TEST_USER, {
				protocolVersion: CURRENT_PROTOCOL_VERSION,
				deviceId: uuidv7(),
				audience: { kind: 'user', id: MCP_TEST_USER },
				manifest: recipes.map(({ id, updatedAt }) => ({
					entityKind: 'recipe' as const,
					entityId: id,
					revision: 1,
					updatedAt,
					previousServerAck: true
				})),
				afterEntityKey: null,
				limit: 5
			})
		)
	};
};

describe('D1 read cost', { timeout: SEEDED_TEST_TIMEOUT_MS }, () => {
	test('household MCP reads, writes, and bootstrap pages cost the same for 10 and 40 meals', async () => {
		const meals = await seedMeals(10);
		const small = await householdCosts(meals);
		meals.push(...(await seedMeals(30)));
		const large = await householdCosts(meals);

		expect(large).toEqual(small);
		for (const statements of Object.values(large)) {
			expect(statements).toBeLessThanOrEqual(MAX_STATEMENTS_PER_OPERATION);
		}
	});

	test('user recipe reads, writes, and bootstrap pages cost the same for 10 and 40 recipes', async () => {
		const recipes = await seedRecipes(10);
		const small = await userCosts(recipes);
		recipes.push(...(await seedRecipes(30)));
		const large = await userCosts(recipes);

		expect(large).toEqual(small);
		for (const statements of Object.values(large)) {
			expect(statements).toBeLessThanOrEqual(MAX_STATEMENTS_PER_OPERATION);
		}
	});
});

describe('D1 bootstrap paging', () => {
	test('walks every household entity exactly once in entity-key order', async () => {
		const meals = await seedMeals(7);
		const port = new D1RemoteDomainPort(database);
		for (const meal of meals.slice(0, 3)) {
			await port.writeMealCheckIn({
				actorUserId: MCP_TEST_USER,
				householdId: MCP_TEST_HOUSEHOLD,
				aggregate: makeCheckIn({
					existing: null,
					mealId: meal.id,
					reporterUserId: MCP_TEST_USER,
					verdict: 'neutral',
					cookTimeMinutes: null,
					reason: null
				})
			});
		}
		const repository = new D1HouseholdSyncRepository(database);
		const keys: string[] = [];
		let afterEntityKey: string | null = null;
		do {
			const page: Awaited<ReturnType<typeof bootstrapHouseholdSync>> = await bootstrapHouseholdSync(
				repository,
				MCP_TEST_HOUSEHOLD,
				{
					protocolVersion: CURRENT_PROTOCOL_VERSION,
					deviceId: uuidv7(),
					audience: { kind: 'household', id: MCP_TEST_HOUSEHOLD },
					manifest: [],
					afterEntityKey,
					limit: 3
				}
			);
			expect(page.aggregates.length).toBeLessThanOrEqual(3);
			keys.push(...page.aggregates.map(({ entityKind, entityId }) => `${entityKind}\0${entityId}`));
			afterEntityKey = page.nextEntityKey;
		} while (afterEntityKey !== null);

		expect(keys).toHaveLength(10);
		expect(new Set(keys).size).toBe(10);
		expect(keys).toEqual(keys.toSorted());
		expect(keys.filter((key) => key.startsWith('meal\0'))).toHaveLength(7);
	});

	test('reports acknowledged manifest entries the server no longer holds', async () => {
		const [meal] = await seedMeals(1);
		const missing = uuidv7();
		const page = await bootstrapHouseholdSync(
			new D1HouseholdSyncRepository(database),
			MCP_TEST_HOUSEHOLD,
			{
				protocolVersion: CURRENT_PROTOCOL_VERSION,
				deviceId: uuidv7(),
				audience: { kind: 'household', id: MCP_TEST_HOUSEHOLD },
				manifest: [meal!.id, missing].map((entityId) => ({
					entityKind: 'meal' as const,
					entityId,
					revision: 1,
					updatedAt: meal!.updatedAt,
					previousServerAck: true
				})),
				afterEntityKey: null,
				limit: 100
			}
		);
		expect(page.instructions).toEqual([
			{ entityKind: 'meal', entityId: missing, action: 'delete_acknowledged_absence' }
		]);
	});
});

import { Schema } from 'effect';
import { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { HouseholdSchema } from '$lib/domain/household/contracts.js';
import { MealAggregateSchema, MealCheckInSchema } from '$lib/domain/meals/schema.js';
import {
	D1HouseholdSyncRepository,
	d1HouseholdSyncCapabilityAuthorizer,
	pullHouseholdSync,
	pushHouseholdSync
} from '$lib/server/sync/index.js';
import type { HouseholdSyncMutation } from '$lib/sync/household-contracts.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

const householdId = 'org_family';
const aliceId = 'user_alice';
const bobId = 'user_bob';
const timestamp = '2026-08-21T12:00:00.000Z' as const;
const deviceId = uuidv7();
let miniflare: Miniflare;
let database: D1Database;
const liveMembership = (overrides: Record<string, unknown> = {}) => ({
	membershipId: 'membership_alice',
	householdId,
	householdName: 'Family',
	roleSlug: 'member',
	permissions: ['meals:read', 'meals:write', 'households:write'],
	...overrides
});

beforeEach(async () => {
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	database = await miniflare.getD1Database('DB');
	await applyD1Migrations(database, await readD1MigrationFiles());
	await database
		.prepare('INSERT INTO users (workos_user_id) VALUES (?), (?)')
		.bind(aliceId, bobId)
		.run();
	await database
		.prepare('INSERT INTO households (household_id, created_by_user_id) VALUES (?, ?)')
		.bind(householdId, aliceId)
		.run();
	for (const [membershipId, userId] of [
		['membership_alice', aliceId],
		['membership_bob', bobId]
	] as const) {
		await database
			.prepare(
				`INSERT INTO household_memberships
				 (membership_id, household_id, workos_user_id, role_slug, permissions, status,
				  workos_created_at, last_verified_at)
				 VALUES (?, ?, ?, 'member', ?, 'active', ?, ?)`
			)
			.bind(
				membershipId,
				householdId,
				userId,
				JSON.stringify(['meals:read', 'meals:write', 'households:write']),
				timestamp,
				timestamp
			)
			.run();
	}
	await database
		.prepare(
			`INSERT INTO billing_subscriptions
			 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
			  current_period_end)
			 VALUES (?, 'cus_test', 'sub_test', 'price_test', 'active', '2026-09-21T12:00:00.000Z')`
		)
		.bind(householdId)
		.run();
});

afterEach(async () => {
	await miniflare.dispose();
});

const meal = (
	id: string,
	mutationId: string,
	occurredAt: `${string}Z`,
	overrides: Record<string, unknown> = {}
) =>
	Schema.decodeUnknownSync(MealAggregateSchema)({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 1,
		createdAt: timestamp,
		updatedAt: occurredAt,
		deletedAt: null,
		conflictClocks: {
			schedule: { occurredAt, originDeviceId: deviceId, mutationId }
		},
		id,
		householdId,
		sourceRecipeId: null,
		title: 'Family soup',
		description: null,
		imageUrl: null,
		date: '2026-08-22',
		time: '18:00',
		sortOrder: 0,
		plannedCookUserId: null,
		yield: 4,
		plannedYield: 4,
		status: 'planned',
		prepTimeMinutes: 5,
		cookTimeMinutes: 20,
		totalTimeMinutes: 25,
		sourceYieldText: 'Serves four',
		sourceDatePublished: null,
		sourceDateModified: null,
		sourceLanguage: 'en',
		sourceUrl: null,
		sourceSiteName: null,
		sourceAuthorName: null,
		sourcePublisherName: null,
		sourceIsBasedOnUrl: null,
		sourceImportedAt: timestamp,
		sourceHtmlHash: null,
		sourceRatingValue: null,
		sourceRatingCount: null,
		sourceReviewCount: null,
		sourceClaimedMinutes: 25,
		parseConfidence: 1,
		ingredientConfidence: 1,
		instructionConfidence: 1,
		nutritionConfidence: null,
		notes: null,
		ingredients: [],
		instructions: [],
		instructionEvents: [],
		applianceRequirements: [],
		classifications: [],
		media: [],
		nutritionFacts: [],
		...overrides
	});

const mealMutation = (
	mealId: string,
	mutationId: string,
	occurredAt: `${string}Z`,
	overrides: Record<string, unknown> = {}
): HouseholdSyncMutation => ({
	schemaVersion: CURRENT_SCHEMA_VERSION,
	mutationId,
	originDeviceId: deviceId,
	entityKind: 'meal',
	entityId: mealId,
	conflictGroups: ['schedule'],
	operation: 'upsert',
	occurredAt,
	aggregate: meal(mealId, mutationId, occurredAt, overrides)
});

describe('D1 household sync', () => {
	test('commits and bootstraps the household settings aggregate', async () => {
		const repository = new D1HouseholdSyncRepository(database);
		const mutationId = uuidv7();
		const settings = Schema.decodeUnknownSync(HouseholdSchema)({
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {
				settings: { occurredAt: timestamp, originDeviceId: deviceId, mutationId }
			},
			householdId,
			name: 'Friday table',
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			weekStartsOn: 1,
			defaultPlannedYield: 6,
			preferredDinnerTime: '18:30',
			createdByUserId: aliceId,
			deletionState: 'active',
			localOnly: false
		});

		await expect(
			repository.commit({
				householdId,
				actorUserId: aliceId,
				deviceId,
				mutation: {
					schemaVersion: 1,
					mutationId,
					originDeviceId: deviceId,
					entityKind: 'household',
					entityId: householdId,
					conflictGroups: ['settings'],
					operation: 'upsert',
					occurredAt: timestamp,
					aggregate: settings
				},
				mode: 'live',
				receivedAt: timestamp
			})
		).resolves.toMatchObject({ status: 'accepted' });
		await expect(repository.bootstrap(householdId)).resolves.toMatchObject({
			aggregates: [
				expect.objectContaining({
					entityKind: 'household',
					entityId: householdId,
					aggregate: expect.objectContaining({ name: 'Friday table', defaultPlannedYield: 6 })
				})
			]
		});
	});

	test('intersects the exact current WorkOS membership, D1 permission, and paid/grace capability', async () => {
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'meals:write',
				now: timestamp
			})
		).resolves.toMatchObject({ householdId, permission: 'meals:write' });
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [],
				permission: 'meals:read',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncPermissionDenied', code: 'workos_membership_missing' });
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [liveMembership({ permissions: ['meals:read'] })],
				permission: 'meals:write',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncPermissionDenied' });

		await database
			.prepare(
				`INSERT INTO household_deletion_requests
				 (household_id, requester_user_id, state, requested_at)
				 VALUES (?, ?, 'refunding', ?)`
			)
			.bind(householdId, aliceId, timestamp)
			.run();
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'meals:read',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncCapabilityDenied' });

		await database
			.prepare(
				`UPDATE household_deletion_requests
				 SET state = 'recovered', stripe_cancellation_id = 'sub_test' WHERE household_id = ?`
			)
			.bind(householdId)
			.run();
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'meals:read',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncCapabilityDenied' });
		await database
			.prepare(
				"UPDATE billing_subscriptions SET stripe_subscription_id = 'sub_restarted' WHERE household_id = ?"
			)
			.bind(householdId)
			.run();
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'meals:read',
				now: timestamp
			})
		).resolves.toMatchObject({ householdId });
		await database
			.prepare(
				'UPDATE household_deletion_requests SET stripe_cancellation_id = NULL WHERE household_id = ?'
			)
			.bind(householdId)
			.run();
		await database
			.prepare(
				"UPDATE billing_subscriptions SET stripe_subscription_id = 'sub_first' WHERE household_id = ?"
			)
			.bind(householdId)
			.run();
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'meals:read',
				now: timestamp
			})
		).resolves.toMatchObject({ householdId });
		await database
			.prepare('UPDATE billing_subscriptions SET current_period_end = ? WHERE household_id = ?')
			.bind(timestamp, householdId)
			.run();
		await expect(
			d1HouseholdSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: aliceId,
				householdId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'meals:read',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncCapabilityDenied' });
	});

	test('uses D1 commit order live and original event time only for historical backfill', async () => {
		const repository = new D1HouseholdSyncRepository(database);
		const mealId = uuidv7();
		const firstId = uuidv7();
		const secondId = uuidv7();
		await repository.commit({
			householdId,
			actorUserId: aliceId,
			deviceId,
			mutation: mealMutation(mealId, firstId, '2026-08-20T12:00:00.000Z'),
			mode: 'live',
			receivedAt: '2026-08-21T12:00:00.000Z'
		});
		await repository.commit({
			householdId,
			actorUserId: bobId,
			deviceId,
			mutation: mealMutation(mealId, secondId, '2026-08-19T12:00:00.000Z', {
				date: '2026-08-24'
			}),
			mode: 'live',
			receivedAt: '2026-08-21T12:00:01.000Z'
		});
		let page = await repository.pull(householdId, 0, 10);
		expect(page.changes.at(-1)?.aggregate).toMatchObject({ date: '2026-08-24' });

		const staleId = uuidv7();
		const stale = await repository.commit({
			householdId,
			actorUserId: aliceId,
			deviceId,
			mutation: mealMutation(mealId, staleId, '2026-07-01T12:00:00.000Z', {
				date: '2026-07-02'
			}),
			mode: 'backfill',
			receivedAt: '2026-08-21T12:00:02.000Z'
		});
		expect(stale).toMatchObject({ status: 'rejected', errorCode: 'historical_loser' });
		page = await repository.pull(householdId, 0, 10);
		expect(page.changes.at(-1)?.aggregate).toMatchObject({ date: '2026-08-24' });
	});

	test('lands a check-in and status-only meal update after the old planned cook leaves', async () => {
		const repository = new D1HouseholdSyncRepository(database);
		const mealId = uuidv7();
		await expect(
			repository.commit({
				householdId,
				actorUserId: aliceId,
				deviceId,
				mutation: mealMutation(mealId, uuidv7(), timestamp, {
					plannedCookUserId: bobId
				}),
				mode: 'live',
				receivedAt: timestamp
			})
		).resolves.toMatchObject({ status: 'accepted' });
		await database
			.prepare("UPDATE household_memberships SET status = 'revoked' WHERE workos_user_id = ?")
			.bind(bobId)
			.run();

		const checkInMutationId = uuidv7();
		const checkInId = uuidv7();
		const statusMutationId = uuidv7();
		const checkIn = Schema.decodeUnknownSync(MealCheckInSchema)({
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {
				response: { occurredAt: timestamp, originDeviceId: deviceId, mutationId: checkInMutationId }
			},
			id: checkInId,
			reporterUserId: aliceId,
			mealId,
			cookTimeMinutes: 30,
			verdict: 'repeat',
			reason: null
		});
		const result = await pushHouseholdSync(repository, householdId, aliceId, {
			protocolVersion: 1,
			deviceId,
			audience: { kind: 'household', id: householdId },
			baseCursor: null,
			mutations: [
				{
					schemaVersion: 1,
					mutationId: checkInMutationId,
					originDeviceId: deviceId,
					entityKind: 'meal_check_in',
					entityId: checkInId,
					conflictGroups: ['response'],
					operation: 'upsert',
					occurredAt: timestamp,
					aggregate: checkIn
				},
				{
					...mealMutation(mealId, statusMutationId, timestamp, {
						plannedCookUserId: bobId,
						status: 'cooked',
						conflictClocks: {
							status: {
								occurredAt: timestamp,
								originDeviceId: deviceId,
								mutationId: statusMutationId
							}
						}
					}),
					conflictGroups: ['status']
				}
			]
		});

		expect(result.receipts).toEqual([
			expect.objectContaining({ status: 'accepted' }),
			expect.objectContaining({ status: 'accepted' })
		]);
		await expect(
			database.prepare('SELECT status FROM meals WHERE id = ?').bind(mealId).first()
		).resolves.toEqual({ status: 'cooked' });
		await expect(
			database.prepare('SELECT id FROM meal_check_ins WHERE id = ?').bind(checkInId).first()
		).resolves.toEqual({ id: checkInId });
	});

	test('is idempotent, rejects cross-profile check-ins, and keeps meal tombstones authoritative', async () => {
		const repository = new D1HouseholdSyncRepository(database);
		const mealId = uuidv7();
		const mutationId = uuidv7();
		const request = {
			protocolVersion: 1 as const,
			deviceId,
			audience: { kind: 'household' as const, id: householdId },
			baseCursor: null,
			mutations: [mealMutation(mealId, mutationId, timestamp)]
		};
		const first = await pushHouseholdSync(repository, householdId, aliceId, request);
		const duplicate = await pushHouseholdSync(repository, householdId, aliceId, request);
		expect(first.receipts[0]?.status).toBe('accepted');
		expect(duplicate.receipts[0]?.status).toBe('duplicate');

		const checkInId = uuidv7();
		const checkInMutationId = uuidv7();
		const checkIn = Schema.decodeUnknownSync(MealCheckInSchema)({
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {
				response: { occurredAt: timestamp, originDeviceId: deviceId, mutationId: checkInMutationId }
			},
			id: checkInId,
			reporterUserId: aliceId,
			mealId,
			cookTimeMinutes: 30,
			verdict: 'repeat',
			reason: null
		});
		await expect(
			pushHouseholdSync(repository, householdId, bobId, {
				...request,
				mutations: [
					{
						schemaVersion: 1,
						mutationId: checkInMutationId,
						originDeviceId: deviceId,
						entityKind: 'meal_check_in',
						entityId: checkInId,
						conflictGroups: ['response'],
						operation: 'upsert',
						occurredAt: timestamp,
						aggregate: checkIn
					}
				]
			})
		).rejects.toMatchObject({ _tag: 'SyncMalformedRequest', code: 'invalid_household_aggregate' });

		const deleteId = uuidv7();
		await repository.commit({
			householdId,
			actorUserId: aliceId,
			deviceId,
			mutation: {
				...mealMutation(mealId, deleteId, '2026-08-22T12:00:00.000Z', {
					deletedAt: '2026-08-22T12:00:00.000Z'
				}),
				operation: 'delete',
				conflictGroups: ['deletion']
			},
			mode: 'live',
			receivedAt: '2026-08-22T12:00:01.000Z'
		});
		const resurrection = await repository.commit({
			householdId,
			actorUserId: bobId,
			deviceId,
			mutation: mealMutation(mealId, uuidv7(), '2026-08-23T12:00:00.000Z'),
			mode: 'live',
			receivedAt: '2026-08-23T12:00:01.000Z'
		});
		expect(resurrection).toMatchObject({ status: 'rejected', errorCode: 'tombstoned_entity' });
		const snapshot = await repository.bootstrap(householdId);
		expect(
			snapshot.aggregates.find(({ entityId }) => entityId === mealId)?.aggregate
		).toMatchObject({
			id: mealId,
			purgedAt: '2026-08-22T12:00:01.000Z'
		});
	});

	test('requires bootstrap below the retained floor', async () => {
		const repository = new D1HouseholdSyncRepository(database);
		const mealId = uuidv7();
		await repository.commit({
			householdId,
			actorUserId: aliceId,
			deviceId,
			mutation: mealMutation(mealId, uuidv7(), timestamp),
			mode: 'live',
			receivedAt: timestamp
		});
		await repository.prune({
			now: '2027-08-22T12:00:00.000Z',
			changeCutoff: '2027-08-22T12:00:00.000Z'
		});
		await expect(
			pullHouseholdSync(repository, householdId, {
				protocolVersion: 1,
				deviceId,
				audience: { kind: 'household', id: householdId },
				after: 0,
				limit: 10
			})
		).rejects.toMatchObject({ _tag: 'SyncBootstrapRequired', code: 'cursor_expired' });
	});

	test('rebuilds bootstrap with its winning actor after ordinary changes are pruned', async () => {
		const repository = new D1HouseholdSyncRepository(database);
		const mealId = uuidv7();
		await repository.commit({
			householdId,
			actorUserId: bobId,
			deviceId,
			mutation: mealMutation(mealId, uuidv7(), timestamp),
			mode: 'live',
			receivedAt: timestamp
		});
		await repository.prune({
			now: '2027-08-22T12:00:00.000Z',
			changeCutoff: '2027-08-22T12:00:00.000Z'
		});

		const snapshot = await repository.bootstrap(householdId);
		expect(snapshot.aggregates).toHaveLength(1);
		expect(snapshot.aggregates[0]).toMatchObject({
			actorUserId: bobId,
			entityKind: 'meal',
			entityId: mealId,
			aggregate: { title: 'Family soup' }
		});
	});
});

import { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	D1UserSyncRepository,
	d1UserSyncCapabilityAuthorizer,
	pullUserSync
} from '$lib/server/sync/index.js';
import type { SyncMutation } from '$lib/sync/contracts.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

const userId = 'user_alice';
const timestamp = '2026-08-21T12:00:00.000Z' as const;
let miniflare: Miniflare;
let database: D1Database;
const liveMembership = (overrides: Record<string, unknown> = {}) => ({
	membershipId: 'membership_paid',
	householdId: 'org_paid',
	householdName: 'Paid',
	roleSlug: 'member',
	permissions: ['recipes:read', 'recipes:write'],
	...overrides
});

beforeEach(async () => {
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-13',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	database = await miniflare.getD1Database('DB');
	await applyD1Migrations(database, await readD1MigrationFiles());
});

afterEach(async () => {
	await miniflare.dispose();
});

const aggregate = (id: string, occurredAt: string, mutationId: string, factor: number) => ({
	id,
	workosUserId: userId,
	canonicalLabel: 'family spoon',
	baseUnitId: 'grams',
	toBaseFactor: factor,
	toBaseOffset: 0,
	adoptionStatus: 'accepted' as const,
	schemaVersion: CURRENT_SCHEMA_VERSION,
	revision: 1,
	createdAt: timestamp,
	updatedAt: occurredAt,
	deletedAt: null,
	conflictClocks: {
		row: { occurredAt, originDeviceId: deviceId, mutationId }
	}
});

const deviceId = uuidv7();
const mutation = (
	entityId: string,
	mutationId: string,
	occurredAt: `${string}Z`,
	factor: number
): SyncMutation => ({
	schemaVersion: CURRENT_SCHEMA_VERSION,
	mutationId,
	originDeviceId: deviceId,
	entityKind: 'unitUserEntry',
	entityId,
	conflictGroups: ['row'],
	operation: 'upsert',
	occurredAt,
	aggregate: aggregate(entityId, occurredAt, mutationId, factor)
});

const recipeAggregate = (id: string, mutationId: string) => ({
	id,
	ownerUserId: userId,
	savedFromHouseholdId: null,
	title: 'Soup',
	description: null,
	imageUrl: 'https://example.com/soup.jpg',
	prepTimeMinutes: 5,
	cookTimeMinutes: 20,
	totalTimeMinutes: 25,
	yield: 4,
	sourceYieldText: 'serves four',
	sourceClaimedMinutes: 25,
	sourceDatePublished: null,
	sourceDateModified: null,
	sourceLanguage: 'en',
	sourceUrl: 'https://example.com/soup',
	sourceSiteName: 'Example',
	sourceAuthorName: null,
	sourcePublisherName: null,
	sourceIsBasedOnUrl: null,
	sourceImportedAt: timestamp,
	sourceHtmlHash: null,
	sourceRatingValue: null,
	sourceRatingCount: null,
	sourceReviewCount: null,
	parseConfidence: 1,
	ingredientConfidence: 1,
	instructionConfidence: 1,
	nutritionConfidence: null,
	userNotes: null,
	ingredients: [
		{
			id: uuidv7(),
			lineIndex: 0,
			originalText: '2 g salt',
			sourceAmountText: '2',
			sourceQuantity: 2,
			sourceUnitLabel: 'g',
			sourceFoodLabel: 'salt',
			baseFoodId: null,
			baseQuantity: 2,
			baseUnitId: 'grams',
			baseUnitFamilyId: 'grams',
			optional: false,
			confidence: 1,
			createdAt: timestamp
		}
	],
	instructions: [],
	instructionEvents: [],
	applianceRequirements: [],
	classifications: [],
	media: [],
	nutritionFacts: [],
	searchTokens: ['soup'],
	schemaVersion: CURRENT_SCHEMA_VERSION,
	revision: 1,
	createdAt: timestamp,
	updatedAt: timestamp,
	deletedAt: null,
	conflictClocks: {
		aggregate: { occurredAt: timestamp, originDeviceId: deviceId, mutationId }
	}
});

describe('D1 user sync repository', () => {
	test('requires a current WorkOS household intersection and active/grace Maal capability', async () => {
		await database.prepare('INSERT INTO users (workos_user_id) VALUES (?)').bind(userId).run();
		await database
			.prepare("INSERT INTO households (household_id, created_by_user_id) VALUES ('org_paid', ?)")
			.bind(userId)
			.run();
		await database
			.prepare(
				`INSERT INTO household_memberships
				 (membership_id, household_id, workos_user_id, role_slug, permissions, status,
				  workos_created_at, last_verified_at)
				 VALUES ('membership_paid', 'org_paid', ?, 'member', ?, 'active', ?, ?)`
			)
			.bind(userId, JSON.stringify(['recipes:read', 'recipes:write']), timestamp, timestamp)
			.run();
		await database
			.prepare(
				`INSERT INTO billing_subscriptions
				 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
				  current_period_end, interruption_started_at, grace_until)
				 VALUES ('org_paid', 'cus_test', 'sub_test', 'price_test', 'paused', ?, ?, ?)`
			)
			.bind('2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z')
			.run();

		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: userId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'recipes:write',
				now: timestamp
			})
		).resolves.toEqual({ householdId: 'org_paid', permission: 'recipes:write' });
		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: userId,
				activeWorkOSMemberships: [liveMembership({ householdId: 'org_removed' })],
				permission: 'recipes:read',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncCapabilityDenied' });
		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: userId,
				activeWorkOSMemberships: [liveMembership({ permissions: ['recipes:read'] })],
				permission: 'recipes:write',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncPermissionDenied' });
		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: userId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'recipes:read',
				now: '2026-09-01T00:00:00.000Z'
			})
		).rejects.toMatchObject({ _tag: 'SyncCapabilityDenied' });

		await database
			.prepare(
				`INSERT INTO household_deletion_requests
				 (household_id, requester_user_id, state, stripe_cancellation_id, requested_at)
				 VALUES ('org_paid', ?, 'recovered', 'sub_test', ?)`
			)
			.bind(userId, timestamp)
			.run();
		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: userId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'recipes:read',
				now: timestamp
			})
		).rejects.toMatchObject({ _tag: 'SyncCapabilityDenied' });
		await database
			.prepare(
				"UPDATE billing_subscriptions SET stripe_subscription_id = 'sub_restarted' WHERE household_id = 'org_paid'"
			)
			.run();
		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: userId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'recipes:read',
				now: timestamp
			})
		).resolves.toMatchObject({ householdId: 'org_paid' });
		await database
			.prepare(
				"UPDATE household_deletion_requests SET stripe_cancellation_id = NULL WHERE household_id = 'org_paid'"
			)
			.run();
		await database
			.prepare(
				"UPDATE billing_subscriptions SET stripe_subscription_id = 'sub_first' WHERE household_id = 'org_paid'"
			)
			.run();
		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: userId,
				activeWorkOSMemberships: [liveMembership()],
				permission: 'recipes:read',
				now: timestamp
			})
		).resolves.toMatchObject({ householdId: 'org_paid' });
	});

	test('commits normalized state, idempotency receipt, version, change, and scope sequence atomically', async () => {
		const repository = new D1UserSyncRepository(database);
		const entityId = uuidv7();
		const firstId = uuidv7();
		const first = mutation(entityId, firstId, timestamp, 3.5);

		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId,
				mutation: first,
				mode: 'live',
				receivedAt: timestamp
			})
		).resolves.toMatchObject({
			mutationId: firstId,
			status: 'accepted',
			sequence: 1,
			resultingRevision: 1
		});
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId,
				mutation: first,
				mode: 'live',
				receivedAt: timestamp
			})
		).resolves.toMatchObject({
			mutationId: firstId,
			status: 'duplicate',
			sequence: 1,
			resultingRevision: 1
		});

		const normalized = await database
			.prepare('SELECT to_base_factor, revision FROM unit_user_entries WHERE id = ?')
			.bind(entityId)
			.first<{ to_base_factor: number; revision: number }>();
		expect(normalized).toEqual({ to_base_factor: 3.5, revision: 1 });
		await expect(
			database.prepare('SELECT COUNT(*) AS count FROM sync_changes').first<{ count: number }>()
		).resolves.toEqual({ count: 1 });
		await expect(
			database
				.prepare('SELECT COUNT(*) AS count FROM sync_mutation_receipts')
				.first<{ count: number }>()
		).resolves.toEqual({ count: 1 });
		await expect(repository.readScopeState(userId)).resolves.toMatchObject({ latestSequence: 1 });
	});

	test('uses D1 commit order live, but rejects month-old backfill and accepts a newer historical edit', async () => {
		const repository = new D1UserSyncRepository(database);
		const entityId = uuidv7();
		const first = mutation(entityId, uuidv7(), timestamp, 1);
		await repository.commit({
			actorUserId: userId,
			deviceId,
			mutation: first,
			mode: 'live',
			receivedAt: timestamp
		});

		const olderLive = mutation(entityId, uuidv7(), '2026-07-01T12:00:00.000Z', 2);
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId,
				mutation: olderLive,
				mode: 'live',
				receivedAt: '2026-08-21T12:00:01.000Z'
			})
		).resolves.toMatchObject({
			status: 'accepted',
			sequence: 2
		});
		const staleBackfill = mutation(entityId, uuidv7(), '2026-06-01T12:00:00.000Z', 3);
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId,
				mutation: staleBackfill,
				mode: 'backfill',
				receivedAt: '2026-08-21T12:00:02.000Z'
			})
		).resolves.toMatchObject({
			status: 'rejected',
			errorCode: 'historical_loser'
		});
		const newerBackfill = mutation(entityId, uuidv7(), '2026-08-20T12:00:00.000Z', 4);
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId,
				mutation: newerBackfill,
				mode: 'backfill',
				receivedAt: '2026-08-21T12:00:03.000Z'
			})
		).resolves.toMatchObject({
			status: 'accepted',
			sequence: 3
		});

		const page = await repository.pull(userId, 0, 100);
		expect(page.changes.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
		expect(page.changes.at(-1)?.aggregate).toMatchObject({ toBaseFactor: 4 });
		await expect(
			database
				.prepare('SELECT to_base_factor FROM unit_user_entries WHERE id = ?')
				.bind(entityId)
				.first<{ to_base_factor: number }>()
		).resolves.toEqual({ to_base_factor: 4 });
	});

	test('rebuilds bootstrap from normalized state after ordinary change retention expires', async () => {
		const repository = new D1UserSyncRepository(database);
		const entityId = uuidv7();
		await repository.commit({
			actorUserId: userId,
			deviceId,
			mutation: mutation(entityId, uuidv7(), timestamp, 8),
			mode: 'live',
			receivedAt: timestamp
		});
		await repository.prune({
			now: '2027-08-21T12:00:00.000Z',
			changeCutoff: '2027-05-21T12:00:00.000Z'
		});

		await expect(
			pullUserSync(repository, userId, {
				protocolVersion: 1,
				deviceId,
				audience: { kind: 'user', id: userId },
				after: 0,
				limit: 100
			})
		).rejects.toMatchObject({
			_tag: 'SyncBootstrapRequired'
		});
		const snapshot = await repository.bootstrap(userId);
		expect(snapshot.aggregates).toHaveLength(1);
		expect(snapshot.aggregates[0]).toMatchObject({
			entityKind: 'unitUserEntry',
			entityId,
			aggregate: { toBaseFactor: 8 }
		});
	});

	test('writes and rehydrates complete normalized recipe aggregates and retained purge tombstones', async () => {
		const repository = new D1UserSyncRepository(database);
		const entityId = uuidv7();
		const mutationId = uuidv7();
		const recipe = recipeAggregate(entityId, mutationId);
		const create: SyncMutation = {
			schemaVersion: 1,
			mutationId,
			originDeviceId: deviceId,
			entityKind: 'recipe',
			entityId,
			conflictGroups: ['aggregate'],
			operation: 'upsert',
			occurredAt: timestamp,
			aggregate: recipe
		};
		await repository.commit({
			actorUserId: userId,
			deviceId,
			mutation: create,
			mode: 'live',
			receivedAt: timestamp
		});
		await expect(
			database.prepare('SELECT title FROM recipes WHERE id = ?').bind(entityId).first()
		).resolves.toEqual({ title: 'Soup' });
		await expect(
			database
				.prepare('SELECT original_text FROM recipe_ingredients WHERE recipe_id = ?')
				.bind(entityId)
				.first()
		).resolves.toEqual({ original_text: '2 g salt' });
		const createdSnapshot = await repository.bootstrap(userId);
		expect(createdSnapshot.aggregates[0]?.aggregate).toMatchObject({
			title: 'Soup',
			ingredients: [{ originalText: '2 g salt', optional: false }]
		});

		const purgeId = uuidv7();
		const purgeTime = '2026-08-22T12:00:00.000Z' as const;
		await repository.commit({
			actorUserId: userId,
			deviceId,
			mode: 'live',
			receivedAt: purgeTime,
			mutation: {
				schemaVersion: 1,
				mutationId: purgeId,
				originDeviceId: deviceId,
				entityKind: 'recipe',
				entityId,
				conflictGroups: ['deletion'],
				operation: 'delete',
				occurredAt: purgeTime,
				aggregate: {
					id: entityId,
					ownerUserId: userId,
					schemaVersion: 1,
					revision: 2,
					createdAt: timestamp,
					updatedAt: purgeTime,
					deletedAt: purgeTime,
					conflictClocks: {
						deletion: { occurredAt: purgeTime, originDeviceId: deviceId, mutationId: purgeId }
					},
					purgedAt: purgeTime,
					retainUntil: '2027-08-22T12:00:00.000Z',
					purgeReason: 'permanent_delete',
					searchTokens: []
				}
			}
		});
		await expect(
			database.prepare('SELECT title FROM recipes WHERE id = ?').bind(entityId).first()
		).resolves.toBeNull();
		await expect(
			database
				.prepare('SELECT deletion_sequence FROM sync_tombstones WHERE entity_id = ?')
				.bind(entityId)
				.first()
		).resolves.toEqual({ deletion_sequence: 2 });
		const deletedSnapshot = await repository.bootstrap(userId);
		expect(deletedSnapshot.aggregates).toContainEqual(
			expect.objectContaining({
				entityId,
				operation: 'delete',
				aggregate: expect.objectContaining({ purgeReason: 'permanent_delete' })
			})
		);

		const staleUpsertId = uuidv7();
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId,
				mode: 'live',
				receivedAt: '2026-08-22T12:00:01.000Z',
				mutation: {
					...create,
					mutationId: staleUpsertId,
					conflictGroups: ['header'],
					occurredAt: '2026-08-20T12:00:00.000Z',
					aggregate: recipeAggregate(entityId, staleUpsertId)
				}
			})
		).resolves.toMatchObject({ status: 'rejected', errorCode: 'tombstoned_entity' });
	});

	test('allows an explicit live restore for a recoverable recipe tombstone', async () => {
		const repository = new D1UserSyncRepository(database);
		const entityId = uuidv7();
		const createId = uuidv7();
		const original = recipeAggregate(entityId, createId);
		await repository.commit({
			actorUserId: userId,
			deviceId,
			mode: 'live',
			receivedAt: timestamp,
			mutation: {
				schemaVersion: 1,
				mutationId: createId,
				originDeviceId: deviceId,
				entityKind: 'recipe',
				entityId,
				conflictGroups: ['aggregate'],
				operation: 'upsert',
				occurredAt: timestamp,
				aggregate: original
			}
		});

		const deleteId = uuidv7();
		const deletedAt = '2026-08-22T12:00:00.000Z' as const;
		const deleted = {
			...original,
			revision: 2,
			updatedAt: deletedAt,
			deletedAt,
			conflictClocks: {
				...original.conflictClocks,
				deletion: { occurredAt: deletedAt, originDeviceId: deviceId, mutationId: deleteId }
			}
		};
		await repository.commit({
			actorUserId: userId,
			deviceId,
			mode: 'live',
			receivedAt: deletedAt,
			mutation: {
				schemaVersion: 1,
				mutationId: deleteId,
				originDeviceId: deviceId,
				entityKind: 'recipe',
				entityId,
				conflictGroups: ['deletion'],
				operation: 'delete',
				occurredAt: deletedAt,
				aggregate: deleted
			}
		});

		const restoreId = uuidv7();
		const restoredAt = '2026-08-23T12:00:00.000Z' as const;
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId,
				mode: 'live',
				receivedAt: restoredAt,
				mutation: {
					schemaVersion: 1,
					mutationId: restoreId,
					originDeviceId: deviceId,
					entityKind: 'recipe',
					entityId,
					conflictGroups: ['deletion'],
					operation: 'upsert',
					occurredAt: restoredAt,
					aggregate: {
						...deleted,
						updatedAt: restoredAt,
						deletedAt: null,
						conflictClocks: {
							...deleted.conflictClocks,
							deletion: {
								occurredAt: restoredAt,
								originDeviceId: deviceId,
								mutationId: restoreId
							}
						}
					}
				}
			})
		).resolves.toMatchObject({ status: 'accepted' });
		await expect(
			database.prepare('SELECT deleted_at FROM recipes WHERE id = ?').bind(entityId).first()
		).resolves.toEqual({ deleted_at: null });
	});
});

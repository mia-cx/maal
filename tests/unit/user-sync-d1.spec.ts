import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openMaalDatabase } from '$lib/client/local/database.js';
import {
	createRecipeFromEditor,
	deleteRecipe,
	restoreRecipe,
	updateRecipeFromEditor
} from '$lib/client/recipes/commands.js';
import { createUserSyncCoordinator, type UserSyncTransport } from '$lib/client/sync/index.js';
import { readReinstatedIds } from '$lib/client/sync/reinstatements.js';
import { markRejectionsSeen, readUnseenRejections } from '$lib/client/sync/rejections.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { renewalCutoff } from '$lib/server/billing/entitlement.js';
import {
	D1UserSyncRepository,
	d1UserSyncCapabilityAuthorizer,
	pullUserSync,
	pushUserSync
} from '$lib/server/sync/index.js';
import type { LiveWorkOSMembership } from '$lib/server/auth-slots/adapter.js';
import { SyncTransportError, type SyncMutation } from '$lib/sync/contracts.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

const userId = 'user_alice';
const timestamp = '2026-08-21T12:00:00.000Z' as const;
const FIRST_PAGE = { afterEntityKey: null, limit: 100, manifest: [] };
let miniflare: Miniflare;
let database: D1Database;
const liveMembership = (overrides: Partial<LiveWorkOSMembership> = {}): LiveWorkOSMembership => ({
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
	test.each([
		{ permissions: ['recipes:read', 'recipes:write'] },
		{ permissions: ['households:write'] },
		{ permissions: ['household:manage'] },
		{ permissions: ['household:meals:manage'] }
	])('authorizes stored $permissions', async ({ permissions }) => {
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
			.bind(userId, JSON.stringify(permissions), timestamp, timestamp)
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
		await database
			.prepare(
				"UPDATE billing_subscriptions SET status = 'active', current_period_end = ? WHERE household_id = 'org_paid'"
			)
			.bind(renewalCutoff(timestamp))
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
		const snapshot = await repository.bootstrap(userId, FIRST_PAGE);
		expect(snapshot.aggregates).toHaveLength(1);
		expect(snapshot.aggregates[0]).toMatchObject({
			entityKind: 'unitUserEntry',
			entityId,
			aggregate: { toBaseFactor: 8 }
		});
	});

	test('a commit landing after the watermark read still reaches the bootstrap page', async () => {
		const concurrent = new D1UserSyncRepository(database);
		const entityId = uuidv7();
		let injected = false;
		// Resolve the scope-state read, then commit a new entity before the
		// identity listing runs — the page must contain it (or the watermark
		// must not cover it).
		const intercepted: D1Database = new Proxy(database, {
			get(target, property) {
				if (property !== 'prepare') {
					const value = Reflect.get(target, property);
					return typeof value === 'function' ? value.bind(target) : value;
				}
				return (sql: string) => {
					const statement = target.prepare(sql);
					if (!sql.includes('FROM sync_scope_state')) return statement;
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
										if (boundProperty !== 'first') {
											const value = Reflect.get(boundTarget, boundProperty);
											return typeof value === 'function' ? value.bind(boundTarget) : value;
										}
										return async () => {
											const result = await bound.first();
											if (!injected) {
												injected = true;
												await concurrent.commit({
													actorUserId: userId,
													deviceId,
													mutation: mutation(entityId, uuidv7(), '2026-08-22T12:00:00.000Z', 3),
													mode: 'live',
													receivedAt: '2026-08-22T12:00:00.000Z'
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
		const repository = new D1UserSyncRepository(intercepted);
		const snapshot = await repository.bootstrap(userId, FIRST_PAGE);
		expect(injected).toBe(true);
		expect(snapshot.aggregates).toEqual(
			expect.arrayContaining([expect.objectContaining({ entityId })])
		);
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
		const createdSnapshot = await repository.bootstrap(userId, FIRST_PAGE);
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
		const deletedSnapshot = await repository.bootstrap(userId, FIRST_PAGE);
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
		const restored = (await repository.pull(userId, 0, 100)).changes.at(-1);
		expect(restored).toMatchObject({ mutationId: restoreId });
		expect(restored).not.toHaveProperty('reinstated');
	});

	test('a recipe edit made within three hours of reaching D1 brings the deleted recipe back', async () => {
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
				aggregate: {
					...original,
					revision: 2,
					updatedAt: deletedAt,
					deletedAt,
					conflictClocks: {
						...original.conflictClocks,
						deletion: { occurredAt: deletedAt, originDeviceId: deviceId, mutationId: deleteId }
					}
				}
			}
		});

		const otherDevice = uuidv7();
		const editId = uuidv7();
		const editedAt = '2026-08-22T09:30:00.000Z' as const;
		const edit = (mutationId: string, occurredAt: `${string}Z`, title: string) => ({
			schemaVersion: 1 as const,
			mutationId,
			originDeviceId: otherDevice,
			entityKind: 'recipe' as const,
			entityId,
			conflictGroups: ['header'] as [string],
			operation: 'upsert' as const,
			occurredAt,
			aggregate: {
				...original,
				title,
				updatedAt: occurredAt,
				conflictClocks: {
					...original.conflictClocks,
					header: { occurredAt, originDeviceId: otherDevice, mutationId }
				}
			}
		});
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId: otherDevice,
				mode: 'live',
				receivedAt: '2026-08-22T12:30:00.000Z',
				mutation: edit(uuidv7(), '2026-08-22T09:29:59.999Z', 'Stale soup')
			})
		).resolves.toMatchObject({ status: 'rejected', errorCode: 'tombstoned_entity' });
		await expect(
			repository.commit({
				actorUserId: userId,
				deviceId: otherDevice,
				mode: 'live',
				receivedAt: '2026-08-22T12:30:00.000Z',
				mutation: edit(editId, editedAt, 'Weeknight soup')
			})
		).resolves.toMatchObject({ status: 'accepted' });

		await expect(
			database.prepare('SELECT title, deleted_at FROM recipes WHERE id = ?').bind(entityId).first()
		).resolves.toEqual({ title: 'Weeknight soup', deleted_at: null });
		expect((await repository.pull(userId, 0, 100)).changes.at(-1)).toMatchObject({
			mutationId: editId,
			reinstated: true,
			conflictGroups: ['header', 'deletion']
		});
	});

	test('keeps an offline recipe edit that was trashed before it synced, through restore', async () => {
		const repository = new D1UserSyncRepository(database);
		const transport: UserSyncTransport = {
			pull: (_slot, request) => pullUserSync(repository, userId, request),
			push: async (_slot, request) => {
				try {
					return await pushUserSync(repository, userId, request);
				} catch (error) {
					throw new SyncTransportError({
						code: (error as { code?: string }).code ?? 'unknown',
						message: 'The sync request was rejected.',
						retryable: false
					});
				}
			},
			bootstrap: () => Promise.reject(new Error('unused')),
			backfill: () => Promise.reject(new Error('unused'))
		};
		const local = await openMaalDatabase(`user-sync-d1-${crypto.randomUUID()}`);
		try {
			const coordinator = createUserSyncCoordinator({
				database: local,
				authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				workosUserId: userId,
				transport,
				capabilityResolver: async () => ({ enabled: true, stale: false, householdId: 'org_paid' }),
				environment: {
					isOnline: () => true,
					isVisible: () => true,
					isSaveDataEnabled: () => true,
					on: () => () => undefined
				}
			});
			const originDeviceId = String((await local.meta.get('deviceId'))!.value);
			const context = (occurredAt: `${string}Z`) => ({
				authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				ownerUserId: userId,
				originDeviceId,
				occurredAt
			});
			const patch = {
				title: 'Soup',
				description: null,
				imageUrl: null,
				sourceUrl: null,
				sourceSiteName: null,
				sourceAuthorName: null,
				sourcePublisherName: null,
				sourceIsBasedOnUrl: null,
				prepTimeMinutes: 5,
				cookTimeMinutes: 20,
				yield: 4,
				ingredients: [{ id: null, amount: '2', unit: 'g', item: 'salt' }],
				instructions: [{ id: null, position: 1, text: 'Simmer.' }]
			};
			const recipe = await createRecipeFromEditor(local, context(timestamp), patch);
			await expect(coordinator.syncNow()).resolves.toBe('complete');

			await updateRecipeFromEditor(local, context('2026-08-21T12:01:00.000Z'), recipe.id, {
				...patch,
				title: 'Better soup'
			});
			await deleteRecipe(local, context('2026-08-21T12:02:00.000Z'), recipe.id);
			await expect(coordinator.syncNow()).resolves.toBe('complete');

			await restoreRecipe(local, context('2026-08-21T12:03:00.000Z'), recipe.id);
			await expect(coordinator.syncNow()).resolves.toBe('complete');

			await expect(
				database
					.prepare('SELECT title, deleted_at FROM recipes WHERE id = ?')
					.bind(recipe.id)
					.first()
			).resolves.toEqual({ title: 'Better soup', deleted_at: null });
			expect(await local.recipes.get(recipe.id)).toMatchObject({
				title: 'Better soup',
				deletedAt: null
			});
		} finally {
			local.close();
			await Dexie.delete(local.name);
		}
	});
});

describe('a recent edit against a deletion, across two devices', () => {
	const slotId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const patch = {
		title: 'Soup',
		description: null,
		imageUrl: null,
		sourceUrl: null,
		sourceSiteName: null,
		sourceAuthorName: null,
		sourcePublisherName: null,
		sourceIsBasedOnUrl: null,
		prepTimeMinutes: 5,
		cookTimeMinutes: 20,
		yield: 4,
		ingredients: [{ id: null, amount: '2', unit: 'g', item: 'salt' }],
		instructions: [{ id: null, position: 1, text: 'Simmer.' }]
	};

	/** One device: its own Dexie and coordinator, pushing to the shared D1 at `serverNow`. */
	const openDevice = async (repository: D1UserSyncRepository, serverNow: () => Date) => {
		const local = await openMaalDatabase(`user-sync-d1-${crypto.randomUUID()}`);
		const profileId = uuidv7();
		await local.profiles.put({
			profileId,
			workosUserId: userId,
			displayName: 'Alice',
			email: null,
			profilePictureUrl: null,
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: timestamp,
			authState: 'authenticated'
		});
		await local.authSlots.put({
			authSlotId: slotId,
			profileId,
			workosUserId: userId,
			sessionState: 'authenticated',
			lastRefreshedAt: timestamp,
			lastVerifiedAt: timestamp,
			nextRetryAt: null,
			retryCount: 0
		});
		await local.uiState.put({ key: 'activeProfileId', value: profileId });
		const transport: UserSyncTransport = {
			pull: (_slot, request) => pullUserSync(repository, userId, request),
			push: (_slot, request) => pushUserSync(repository, userId, request, serverNow),
			bootstrap: () => Promise.reject(new Error('unused')),
			backfill: () => Promise.reject(new Error('unused'))
		};
		const coordinator = createUserSyncCoordinator({
			database: local,
			authSlotId: slotId,
			workosUserId: userId,
			transport,
			capabilityResolver: async () => ({ enabled: true, stale: false, householdId: 'org_paid' }),
			environment: {
				isOnline: () => true,
				isVisible: () => true,
				isSaveDataEnabled: () => true,
				on: () => () => undefined
			}
		});
		const originDeviceId = String((await local.meta.get('deviceId'))!.value);
		const context = (occurredAt: `${string}Z`) => ({
			authSlotId: slotId,
			ownerUserId: userId,
			originDeviceId,
			occurredAt
		});
		return { local, coordinator, context };
	};

	const devices: Awaited<ReturnType<typeof openDevice>>[] = [];
	afterEach(async () => {
		for (const { local } of devices.splice(0)) {
			local.close();
			await Dexie.delete(local.name);
		}
	});

	/** Phone edits the recipe offline at 12:10; laptop deletes it at 12:20. */
	const editAgainstDeletion = async () => {
		const repository = new D1UserSyncRepository(database);
		let serverNow = new Date(timestamp);
		const clock = () => serverNow;
		const laptop = await openDevice(repository, clock);
		const phone = await openDevice(repository, clock);
		devices.push(laptop, phone);

		const recipe = await createRecipeFromEditor(laptop.local, laptop.context(timestamp), patch);
		await expect(laptop.coordinator.syncNow()).resolves.toBe('complete');
		await expect(phone.coordinator.syncNow()).resolves.toBe('complete');

		await updateRecipeFromEditor(
			phone.local,
			phone.context('2026-08-21T12:10:00.000Z'),
			recipe.id,
			{ ...patch, title: 'Phone soup' }
		);
		serverNow = new Date('2026-08-21T12:20:00.000Z');
		await deleteRecipe(laptop.local, laptop.context('2026-08-21T12:20:00.000Z'), recipe.id);
		await expect(laptop.coordinator.syncNow()).resolves.toBe('complete');

		return {
			recipeId: recipe.id,
			laptop,
			phone,
			phoneSyncsAt: async (at: `${string}Z`) => {
				serverNow = new Date(at);
				await expect(phone.coordinator.syncNow()).resolves.toBe('complete');
			}
		};
	};

	test('an edit that reaches D1 within three hours brings the recipe back, marked Reinstated', async () => {
		const { recipeId, laptop, phone, phoneSyncsAt } = await editAgainstDeletion();

		await phoneSyncsAt('2026-08-21T12:40:00.000Z');
		await expect(laptop.coordinator.syncNow()).resolves.toBe('complete');

		expect(await laptop.local.recipes.get(recipeId)).toMatchObject({
			title: 'Phone soup',
			deletedAt: null
		});
		expect(await readReinstatedIds(laptop.local, 'recipe')).toEqual(new Set([recipeId]));
		// The phone never saw the recipe disappear, so it shows no badge.
		expect(await readReinstatedIds(phone.local, 'recipe')).toEqual(new Set());
		await expect(readUnseenRejections(phone.local)).resolves.toEqual([]);
	});

	test('an edit that reaches D1 after three hours is rejected, and the phone says so', async () => {
		const { recipeId, phone, phoneSyncsAt } = await editAgainstDeletion();

		await phoneSyncsAt('2026-08-21T15:10:00.001Z');

		expect(await phone.local.recipes.get(recipeId)).toMatchObject({
			deletedAt: '2026-08-21T12:20:00.000Z'
		});
		const notices = await readUnseenRejections(phone.local);
		expect(notices.map(({ message }) => message)).toEqual([
			'Your change to “Soup” wasn’t saved because it was deleted.'
		]);
		await markRejectionsSeen(
			phone.local,
			notices.map(({ mutationId }) => mutationId)
		);
		await expect(readUnseenRejections(phone.local)).resolves.toEqual([]);
	});
});

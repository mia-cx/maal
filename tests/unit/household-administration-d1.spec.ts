import type { RequestEvent } from '@sveltejs/kit';
import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { HouseholdRole } from '$lib/domain/household/contracts.js';
import {
	HouseholdAdministrationRepository,
	HouseholdAdministrationService,
	handleHouseholdAdministrationRequest,
	type HouseholdAdministrationActor,
	type HouseholdIdentityAdapter,
	type IdentityHousehold,
	type IdentityMembership,
	type IdentityUser
} from '$lib/server/household-administration/index.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

const timestamp = '2026-08-22T08:00:00.000Z';
const aliceId = 'user_alice';
const bobId = 'user_bob';
const charlieId = 'user_charlie';

const permissionsFor = (roleSlug: HouseholdRole): readonly string[] =>
	roleSlug === 'admin'
		? ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write']
		: roleSlug === 'member'
			? ['recipes:read', 'recipes:write', 'meals:read', 'meals:write']
			: ['recipes:read', 'meals:read'];

class FakeHouseholdIdentity implements HouseholdIdentityAdapter {
	readonly households = new Map<string, IdentityHousehold>();
	readonly memberships = new Map<string, IdentityMembership>();
	readonly users = new Map<string, IdentityUser>();
	readonly idempotentHouseholds = new Map<string, string>();
	failNextMembershipCreate = false;
	private householdSequence = 0;
	private membershipSequence = 0;

	constructor() {
		for (const [id, name] of [
			[aliceId, 'Alice Janssen'],
			[bobId, 'Bob Janssen'],
			[charlieId, 'Charlie Janssen']
		] as const) {
			this.users.set(id, {
				id,
				displayName: name,
				email: `${id.slice(5)}@example.test`,
				profilePictureUrl: null
			});
		}
	}

	async createHousehold(input: {
		name: string;
		idempotencyKey: string;
	}): Promise<IdentityHousehold> {
		const existingId = this.idempotentHouseholds.get(input.idempotencyKey);
		if (existingId) return this.households.get(existingId)!;
		this.householdSequence += 1;
		const household = {
			id: `org_created_${this.householdSequence}`,
			name: input.name,
			createdAt: timestamp,
			updatedAt: timestamp
		};
		this.households.set(household.id, household);
		this.idempotentHouseholds.set(input.idempotencyKey, household.id);
		return household;
	}

	async deleteHousehold(householdId: string): Promise<void> {
		this.households.delete(householdId);
		for (const [id, membership] of this.memberships) {
			if (membership.householdId === householdId) this.memberships.delete(id);
		}
	}

	async getHousehold(householdId: string): Promise<IdentityHousehold> {
		const household = this.households.get(householdId);
		if (!household) throw new Error('household missing');
		return household;
	}

	async getUser(workosUserId: string): Promise<IdentityUser> {
		const user = this.users.get(workosUserId);
		if (!user) throw new Error('user missing');
		return user;
	}

	async listMemberships(householdId: string): Promise<readonly IdentityMembership[]> {
		return [...this.memberships.values()].filter(
			(membership) => membership.householdId === householdId
		);
	}

	async getMembership(membershipId: string): Promise<IdentityMembership | null> {
		return this.memberships.get(membershipId) ?? null;
	}

	async findMembership(
		householdId: string,
		workosUserId: string
	): Promise<IdentityMembership | null> {
		return (
			[...this.memberships.values()].find(
				(membership) =>
					membership.householdId === householdId && membership.workosUserId === workosUserId
			) ?? null
		);
	}

	async createMembership(input: {
		householdId: string;
		workosUserId: string;
		roleSlug: HouseholdRole;
	}): Promise<IdentityMembership> {
		if (this.failNextMembershipCreate) {
			this.failNextMembershipCreate = false;
			throw new Error('membership create failed');
		}
		const existing = await this.findMembership(input.householdId, input.workosUserId);
		if (existing) return existing;
		this.membershipSequence += 1;
		const membership = {
			id: `membership_${this.membershipSequence}`,
			householdId: input.householdId,
			workosUserId: input.workosUserId,
			roleSlug: input.roleSlug,
			permissions: permissionsFor(input.roleSlug),
			directoryManaged: false,
			createdAt: timestamp,
			updatedAt: timestamp
		};
		this.memberships.set(membership.id, membership);
		return membership;
	}

	async updateMembershipRole(
		membershipId: string,
		roleSlug: HouseholdRole
	): Promise<IdentityMembership> {
		const membership = this.memberships.get(membershipId);
		if (!membership) throw new Error('membership missing');
		const updated = { ...membership, roleSlug, permissions: permissionsFor(roleSlug) };
		this.memberships.set(membershipId, updated);
		return updated;
	}

	async deleteMembership(membershipId: string): Promise<void> {
		this.memberships.delete(membershipId);
	}
}

let miniflare: Miniflare;
let database: D1Database;
let repository: HouseholdAdministrationRepository;
let identity: FakeHouseholdIdentity;
let now = timestamp;

const actor = (
	workosUserId: string,
	activeOrganizationIds: readonly string[]
): HouseholdAdministrationActor => ({
	authSlotId: `slot_${workosUserId}`,
	workosUserId,
	activeOrganizationIds
});

const service = (): HouseholdAdministrationService =>
	new HouseholdAdministrationService(repository, identity, () => now);

const bootstrapHousehold = async (
	householdId = 'org_family'
): Promise<{ alice: IdentityMembership; bob: IdentityMembership }> => {
	identity.households.set(householdId, {
		id: householdId,
		name: 'Canal kitchen',
		createdAt: timestamp,
		updatedAt: timestamp
	});
	const alice = await identity.createMembership({
		householdId,
		workosUserId: aliceId,
		roleSlug: 'admin'
	});
	const bob = await identity.createMembership({
		householdId,
		workosUserId: bobId,
		roleSlug: 'member'
	});
	await repository.projectCreatedHousehold({
		workosUserId: aliceId,
		householdId,
		membership: alice,
		settings: { name: 'Canal kitchen', locale: 'en-NL', timezone: 'Europe/Amsterdam' },
		now
	});
	await repository.projectMemberships(householdId, [alice, bob], now);
	return { alice, bob };
};

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
	repository = new HouseholdAdministrationRepository(database);
	identity = new FakeHouseholdIdentity();
	now = timestamp;
});

afterEach(async () => {
	await miniflare.dispose();
});

describe('household administration Worker service', () => {
	test('creates one WorkOS household through the real HTTP contract and replays idempotently', async () => {
		const request = () =>
			new Request('https://maal.test/api/auth-slots/slot/households', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'idempotency-key': 'create-family' },
				body: JSON.stringify({
					name: 'Canal kitchen',
					locale: 'en-NL',
					timezone: 'Europe/Amsterdam'
				})
			});
		const event = (nextRequest: Request) =>
			({
				request: nextRequest,
				params: { slot: 'slot_alice' },
				platform: { env: { DB: database } } as App.Platform,
				cookies: {} as RequestEvent['cookies']
			}) satisfies Pick<RequestEvent, 'request' | 'params' | 'platform' | 'cookies'>;
		const dependencies = {
			authenticate: async () => actor(aliceId, []),
			identity,
			now: () => now
		};

		const first = await handleHouseholdAdministrationRequest(
			event(request()) as RequestEvent,
			'createHousehold',
			dependencies
		);
		const replay = await handleHouseholdAdministrationRequest(
			event(request()) as RequestEvent,
			'createHousehold',
			dependencies
		);
		expect(first.status).toBe(200);
		expect(replay.status).toBe(200);
		expect(await first.json()).toMatchObject({
			schemaVersion: 1,
			payload: {
				household: { householdId: 'org_created_1' },
				members: [{ user: { workosUserId: aliceId } }]
			}
		});
		await expect(
			database.prepare('SELECT COUNT(*) AS count FROM households').first<{ count: number }>()
		).resolves.toEqual({ count: 1 });
		await expect(
			database
				.prepare('SELECT COUNT(*) AS count FROM household_memberships')
				.first<{ count: number }>()
		).resolves.toEqual({ count: 1 });
	});

	test('stores only invite hashes, consumes once, and treats a join replay as the same mutation', async () => {
		await bootstrapHousehold();
		const code = '23456789ABCD';
		await service().createInvite({
			actor: actor(aliceId, ['org_family']),
			householdId: 'org_family',
			request: {
				householdId: 'org_family',
				code,
				roleSlug: 'member',
				expiresInDays: 7,
				maxUses: 1
			}
		});
		const raw = await database
			.prepare('SELECT code_hash, uses_count FROM household_invites')
			.first<{ code_hash: string; uses_count: number }>();
		expect(raw?.code_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(raw?.code_hash).not.toContain(code);

		identity.memberships.delete((await identity.findMembership('org_family', bobId))!.id);
		await repository.markMembershipRevoked(
			(await repository.membership('org_family', bobId))!.membershipId,
			now
		);
		const joined = await service().joinHousehold({ actor: actor(bobId, []), code });
		const replay = await service().joinHousehold({ actor: actor(bobId, ['org_family']), code });
		expect(joined.membership.workosUserId).toBe(bobId);
		expect(replay.membership.membershipId).toBe(joined.membership.membershipId);
		await expect(
			database.prepare('SELECT uses_count FROM household_invites').first<{ uses_count: number }>()
		).resolves.toEqual({ uses_count: 1 });
		await expect(
			service().joinHousehold({ actor: actor(charlieId, []), code })
		).rejects.toMatchObject({ code: 'invite_exhausted' });
	});

	test('rejects revoked and expired invites and releases a claimed use after WorkOS failure', async () => {
		await bootstrapHousehold();
		const revokedCode = '23456789ABCE';
		const revoked = await service().createInvite({
			actor: actor(aliceId, ['org_family']),
			householdId: 'org_family',
			request: {
				householdId: 'org_family',
				code: revokedCode,
				roleSlug: 'member',
				expiresInDays: 1,
				maxUses: null
			}
		});
		await service().revokeInvite({
			actor: actor(aliceId, ['org_family']),
			householdId: 'org_family',
			inviteId: revoked.id
		});
		await expect(
			service().joinHousehold({ actor: actor(charlieId, []), code: revokedCode })
		).rejects.toMatchObject({ code: 'invite_revoked' });

		const expiringCode = '23456789ABCF';
		await service().createInvite({
			actor: actor(aliceId, ['org_family']),
			householdId: 'org_family',
			request: {
				householdId: 'org_family',
				code: expiringCode,
				roleSlug: 'member',
				expiresInDays: 1,
				maxUses: null
			}
		});
		now = '2026-08-23T08:00:00.001Z';
		await expect(
			service().joinHousehold({ actor: actor(charlieId, []), code: expiringCode })
		).rejects.toMatchObject({ code: 'invite_expired' });

		now = timestamp;
		const failingCode = '23456789ABCG';
		await service().createInvite({
			actor: actor(aliceId, ['org_family']),
			householdId: 'org_family',
			request: {
				householdId: 'org_family',
				code: failingCode,
				roleSlug: 'member',
				expiresInDays: 7,
				maxUses: null
			}
		});
		identity.failNextMembershipCreate = true;
		await expect(
			service().joinHousehold({ actor: actor(charlieId, []), code: failingCode })
		).rejects.toMatchObject({ code: 'workos_unavailable' });
		const failingInvite = await database
			.prepare('SELECT uses_count FROM household_invites WHERE id != ? ORDER BY created_at DESC')
			.bind(revoked.id)
			.all<{ uses_count: number }>();
		expect(failingInvite.results.some(({ uses_count }) => uses_count === 0)).toBe(true);
	});

	test('intersects live and projected permissions for role changes and member removal', async () => {
		const { bob } = await bootstrapHousehold();
		await expect(
			service().updateMemberRole({
				actor: actor(bobId, ['org_family']),
				householdId: 'org_family',
				membershipId: bob.id,
				roleSlug: 'child'
			})
		).rejects.toMatchObject({ code: 'permission_denied' });

		await expect(
			service().updateMemberRole({
				actor: actor(aliceId, ['org_family']),
				householdId: 'org_family',
				membershipId: bob.id,
				roleSlug: 'child'
			})
		).resolves.toMatchObject({ roleSlug: 'child' });
		await service().removeMember({
			actor: actor(aliceId, ['org_family']),
			householdId: 'org_family',
			membershipId: bob.id
		});
		await expect(repository.membership('org_family', bobId)).resolves.toMatchObject({
			status: 'revoked'
		});
		await expect(
			service().removeMember({
				actor: actor(aliceId, ['org_family']),
				householdId: 'org_family',
				membershipId: bob.id
			})
		).resolves.toBeUndefined();
	});

	test('blocks the billing owner and last admin, then leaves and replays safely', async () => {
		const { alice, bob } = await bootstrapHousehold();
		await service().updateMemberRole({
			actor: actor(aliceId, ['org_family']),
			householdId: 'org_family',
			membershipId: bob.id,
			roleSlug: 'admin'
		});
		await database
			.prepare(
				`INSERT INTO billing_subscriptions
				 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
				  subscriber_user_id, status, current_period_end)
				 VALUES ('org_family', 'cus_test', 'sub_test', 'price_test', ?, 'active', ?)`
			)
			.bind(aliceId, '2026-09-22T08:00:00.000Z')
			.run();
		await expect(
			service().leaveHousehold({ actor: actor(aliceId, ['org_family']), householdId: 'org_family' })
		).rejects.toMatchObject({ code: 'billing_owner_required' });
		await database
			.prepare('UPDATE billing_subscriptions SET subscriber_user_id = ? WHERE household_id = ?')
			.bind(bobId, 'org_family')
			.run();
		await expect(
			service().leaveHousehold({ actor: actor(aliceId, ['org_family']), householdId: 'org_family' })
		).resolves.toBe(alice.id);
		await expect(
			service().leaveHousehold({ actor: actor(aliceId, ['org_family']), householdId: 'org_family' })
		).resolves.toBe(alice.id);
		await expect(repository.membership('org_family', aliceId)).resolves.toMatchObject({
			status: 'revoked'
		});

		await expect(
			service().leaveHousehold({ actor: actor(bobId, ['org_family']), householdId: 'org_family' })
		).rejects.toMatchObject({ code: 'last_admin' });
	});

	test('refreshes safe member identities and revokes only missing household projections', async () => {
		const { bob } = await bootstrapHousehold();
		identity.memberships.delete(bob.id);
		const projection = await service().refreshHousehold(
			actor(aliceId, ['org_family']),
			'org_family'
		);
		expect(projection.members).toMatchObject([
			{ user: { workosUserId: aliceId, displayName: 'Alice Janssen' } }
		]);
		await expect(repository.membership('org_family', bobId)).resolves.toMatchObject({
			status: 'revoked'
		});
		await expect(repository.membership('org_family', aliceId)).resolves.toMatchObject({
			status: 'active'
		});
	});
});

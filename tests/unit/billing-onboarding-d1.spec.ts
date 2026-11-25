import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { attemptOnboardingTrial, BillingRepository } from '$lib/server/billing/index.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

const now = '2026-11-24T05:00:00.000Z';
const actor = { workosUserId: 'user_alice', email: 'alice@example.test' };
const noStripe = { STRIPE_SECRET_KEY: '' };
let miniflare: Miniflare;
let database: D1Database;
let repository: BillingRepository;

beforeEach(async () => {
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		d1Databases: ['DB']
	});
	database = await miniflare.getD1Database('DB');
	await applyD1Migrations(database, await readD1MigrationFiles());
	await database.batch([
		database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice'), ('user_bob')"),
		database.prepare(
			"INSERT INTO households (household_id, created_by_user_id) VALUES ('org_first', 'user_alice'), ('org_second', 'user_alice')"
		)
	]);
	repository = new BillingRepository(database);
});

afterEach(async () => {
	await miniflare.dispose();
});

test('an eligible household survives a trial failure at the Stripe configuration boundary', async () => {
	await expect(repository.trialClaimAvailability(actor.workosUserId)).resolves.toBe('available');
	await expect(
		attemptOnboardingTrial(noStripe, { repository, ...actor, householdId: 'org_first', now })
	).resolves.toBeNull();
	await expect(repository.subscription('org_first')).resolves.toBeNull();
	await expect(repository.trialClaimAvailability(actor.workosUserId)).resolves.toBe('available');
	await expect(
		database
			.prepare('SELECT household_id FROM households WHERE household_id = ?')
			.bind('org_first')
			.first()
	).resolves.toEqual({ household_id: 'org_first' });
});

test('a projected trial prevents new claims by its user or household and survives creation replay', async () => {
	await repository.reserveTrial({
		id: 'first-claim',
		workosUserId: actor.workosUserId,
		householdId: 'org_first',
		reservedAt: now
	});
	await repository.commitStartedTrial({
		claimId: 'first-claim',
		startedAt: now,
		projection: {
			householdId: 'org_first',
			stripeCustomerId: 'cus_fixture',
			stripeSubscriptionId: 'sub_fixture',
			stripePriceId: 'price_fixture',
			subscriberUserId: actor.workosUserId,
			status: 'trialing',
			currentPeriodEnd: '2026-12-24T05:00:00.000Z',
			cancelAtPeriodEnd: false,
			interruptionStartedAt: null,
			graceUntil: null,
			lastSuccessfulPaymentAt: null,
			eventId: 'trial:first-claim',
			eventCreatedAt: now
		}
	});

	await expect(repository.trialClaimAvailability(actor.workosUserId)).resolves.toBe(
		'user_already_claimed'
	);
	await expect(repository.trialClaimAvailability('user_bob')).resolves.toBe('available');
	await expect(
		attemptOnboardingTrial(noStripe, { repository, ...actor, householdId: 'org_second', now })
	).resolves.toBeNull();
	await expect(
		attemptOnboardingTrial(noStripe, {
			repository,
			workosUserId: 'user_bob',
			email: 'bob@example.test',
			householdId: 'org_first',
			now
		})
	).resolves.toBeNull();
	await expect(
		attemptOnboardingTrial(noStripe, { repository, ...actor, householdId: 'org_first', now })
	).resolves.toMatchObject({
		householdId: 'org_first',
		state: 'enabled',
		stripeStatus: 'trialing',
		subscriberUserId: actor.workosUserId,
		stripePriceId: 'price_fixture',
		validUntil: '2026-12-24T06:00:00.000Z'
	});
	await expect(repository.subscription('org_second')).resolves.toBeNull();
});

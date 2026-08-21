import { and, eq, gte, lte, or } from 'drizzle-orm';

import type { StripeSubscriptionStatus } from '$lib/domain/billing/contracts.js';
import { getDb } from '$lib/server/db/index.js';
import {
	billingAuditEvents,
	billingSubscriptions,
	billingTrialClaims,
	householdDeletionRequests,
	householdMemberships,
	stripeEvents
} from '$lib/server/db/schema/index.js';

export type BillingSubscriptionRow = typeof billingSubscriptions.$inferSelect;
export type HouseholdDeletionRow = typeof householdDeletionRequests.$inferSelect;

export interface SubscriptionProjectionWrite {
	readonly householdId: string;
	readonly stripeCustomerId: string;
	readonly stripeSubscriptionId: string;
	readonly stripePriceId: string;
	readonly subscriberUserId: string | null;
	readonly status: StripeSubscriptionStatus;
	readonly currentPeriodEnd: string;
	readonly cancelAtPeriodEnd: boolean;
	readonly interruptionStartedAt: string | null;
	readonly graceUntil: string | null;
	readonly lastSuccessfulPaymentAt: string | null;
	readonly eventId: string;
	readonly eventCreatedAt: string;
}

export class BillingRepository {
	constructor(readonly database: D1Database) {}

	async subscription(householdId: string): Promise<BillingSubscriptionRow | null> {
		return (
			await getDb(this.database)
				.select()
				.from(billingSubscriptions)
				.where(eq(billingSubscriptions.householdId, householdId))
				.limit(1)
		)[0] ?? null;
	}

	async subscriptionByStripeId(subscriptionId: string): Promise<BillingSubscriptionRow | null> {
		return (
			await getDb(this.database)
				.select()
				.from(billingSubscriptions)
				.where(eq(billingSubscriptions.stripeSubscriptionId, subscriptionId))
				.limit(1)
		)[0] ?? null;
	}

	async trialClaimAvailability(
		workosUserId: string,
		householdId: string
	): Promise<'available' | 'user_already_claimed' | 'household_already_claimed'> {
		const rows = await getDb(this.database)
			.select({ workosUserId: billingTrialClaims.workosUserId, householdId: billingTrialClaims.householdId })
			.from(billingTrialClaims)
			.where(
				or(
					eq(billingTrialClaims.workosUserId, workosUserId),
					eq(billingTrialClaims.householdId, householdId)
				)
			);
		if (rows.some((row) => row.workosUserId === workosUserId)) return 'user_already_claimed';
		if (rows.some((row) => row.householdId === householdId)) return 'household_already_claimed';
		return 'available';
	}

	async reserveTrial(input: {
		id: string;
		workosUserId: string;
		householdId: string;
		reservedAt: string;
	}): Promise<void> {
		await getDb(this.database).insert(billingTrialClaims).values({
			...input,
			state: 'reserved',
			updatedAt: input.reservedAt
		});
	}

	async abandonTrialReservation(id: string): Promise<void> {
		await getDb(this.database)
			.delete(billingTrialClaims)
			.where(and(eq(billingTrialClaims.id, id), eq(billingTrialClaims.state, 'reserved')));
	}

	async markTrialRollbackPending(input: {
		id: string;
		stripeCustomerId: string | null;
		stripeSubscriptionId: string | null;
		updatedAt: string;
	}): Promise<void> {
		await getDb(this.database)
			.update(billingTrialClaims)
			.set({
				state: 'rollback_pending',
				stripeCustomerId: input.stripeCustomerId,
				stripeSubscriptionId: input.stripeSubscriptionId,
				updatedAt: input.updatedAt
			})
			.where(eq(billingTrialClaims.id, input.id));
	}

	async commitStartedTrial(input: {
		claimId: string;
		startedAt: string;
		projection: SubscriptionProjectionWrite;
	}): Promise<void> {
		const p = input.projection;
		await this.database.batch([
			this.database
				.prepare(
					`UPDATE billing_trial_claims SET state = 'started', stripe_customer_id = ?, stripe_subscription_id = ?, started_at = ?, updated_at = ? WHERE id = ?`
				)
				.bind(p.stripeCustomerId, p.stripeSubscriptionId, input.startedAt, input.startedAt, input.claimId),
			this.subscriptionUpsertStatement(p, input.startedAt),
			this.auditStatement({
				idempotencyKey: `trial:${input.claimId}:started`,
				householdId: p.householdId,
				actorUserId: p.subscriberUserId,
				eventType: 'trial_started',
				occurredAt: input.startedAt,
				safeDetails: { subscriptionId: p.stripeSubscriptionId }
			})
		]);
	}

	async beginStripeEvent(input: {
		id: string;
		type: string;
		receivedAt: string;
	}): Promise<'acquired' | 'duplicate'> {
		await getDb(this.database)
			.insert(stripeEvents)
			.values({
				stripeEventId: input.id,
				type: input.type,
				state: 'pending',
				attempts: 0,
				receivedAt: input.receivedAt
			})
			.onConflictDoNothing();
		const existing = (
			await getDb(this.database)
				.select({ state: stripeEvents.state })
				.from(stripeEvents)
				.where(eq(stripeEvents.stripeEventId, input.id))
				.limit(1)
		)[0];
		if (existing?.state === 'processed') return 'duplicate';
		// Increment in SQLite so retries never race a read-modify-write cycle.
		await this.database
			.prepare('UPDATE stripe_events SET attempts = attempts + 1, state = ? WHERE stripe_event_id = ?')
			.bind('processing', input.id)
			.run();
		return 'acquired';
	}

	async finishStripeEventWithoutProjection(eventId: string, processedAt: string): Promise<void> {
		await this.database
			.prepare(
				`UPDATE stripe_events SET state = 'processed', processed_at = ?, safe_error_code = NULL WHERE stripe_event_id = ?`
			)
			.bind(processedAt, eventId)
			.run();
	}

	async commitStripeProjection(
		eventId: string,
		projection: SubscriptionProjectionWrite,
		processedAt: string
	): Promise<void> {
		await this.database.batch([
			this.subscriptionUpsertStatement(projection, processedAt),
			this.database
				.prepare(
					`UPDATE stripe_events SET state = 'processed', processed_at = ?, safe_error_code = NULL WHERE stripe_event_id = ?`
				)
				.bind(processedAt, eventId)
		]);
	}

	async failStripeEvent(eventId: string, safeErrorCode: string): Promise<void> {
		await this.database
			.prepare(`UPDATE stripe_events SET state = 'failed', safe_error_code = ? WHERE stripe_event_id = ?`)
			.bind(safeErrorCode, eventId)
			.run();
	}

	async transferBillingOwner(input: {
		householdId: string;
		currentUserId: string;
		newUserId: string;
		updatedAt: string;
	}): Promise<BillingSubscriptionRow | null> {
		const target = (
			await getDb(this.database)
				.select({ roleSlug: householdMemberships.roleSlug, status: householdMemberships.status })
				.from(householdMemberships)
				.where(
					and(
						eq(householdMemberships.householdId, input.householdId),
						eq(householdMemberships.workosUserId, input.newUserId)
					)
				)
				.limit(1)
		)[0];
		if (target?.status !== 'active' || target.roleSlug !== 'admin') return null;
		const updated = await getDb(this.database)
			.update(billingSubscriptions)
			.set({ subscriberUserId: input.newUserId, updatedAt: input.updatedAt })
			.where(
				and(
					eq(billingSubscriptions.householdId, input.householdId),
					eq(billingSubscriptions.subscriberUserId, input.currentUserId)
				)
			)
			.returning();
		return updated[0] ?? null;
	}

	async deletionRequest(householdId: string): Promise<HouseholdDeletionRow | null> {
		return (
			await getDb(this.database)
				.select()
				.from(householdDeletionRequests)
				.where(eq(householdDeletionRequests.householdId, householdId))
				.limit(1)
		)[0] ?? null;
	}

	async upsertDeletionRequest(
		input: typeof householdDeletionRequests.$inferInsert
	): Promise<void> {
		await getDb(this.database)
			.insert(householdDeletionRequests)
			.values(input)
			.onConflictDoUpdate({
				target: householdDeletionRequests.householdId,
				set: input
			});
	}

	async recoverHousehold(householdId: string, recoveredAt: string): Promise<boolean> {
		const rows = await getDb(this.database)
			.update(householdDeletionRequests)
			.set({ state: 'recovered', updatedAt: recoveredAt, safeErrorCode: null })
			.where(
				and(
					eq(householdDeletionRequests.householdId, householdId),
					eq(householdDeletionRequests.state, 'recoverable'),
					// SQLite compares canonical UTC instants lexicographically.
					gte(householdDeletionRequests.recoverableUntil, recoveredAt)
				)
			)
			.returning({ householdId: householdDeletionRequests.householdId });
		return rows.length > 0;
	}

	async expiredRecoverableHouseholds(now: string): Promise<string[]> {
		return (
			await getDb(this.database)
				.select({ householdId: householdDeletionRequests.householdId })
				.from(householdDeletionRequests)
				.where(
					and(
						eq(householdDeletionRequests.state, 'recoverable'),
						lte(householdDeletionRequests.recoverableUntil, now)
					)
				)
		).map(({ householdId }) => householdId);
	}

	async purgeHouseholdContent(householdId: string, purgedAt: string): Promise<void> {
		// Foreign-key cascades remove household-owned normalized content. User recipes survive and
		// their saved-from reference is SET NULL by the schema.
		await this.database.batch([
			this.database.prepare('DELETE FROM households WHERE household_id = ?').bind(householdId),
			this.database
				.prepare(
					`UPDATE household_deletion_requests SET state = 'purged', purged_at = ?, updated_at = ?, safe_error_code = NULL WHERE household_id = ?`
				)
				.bind(purgedAt, purgedAt, householdId)
		]);
	}

	async audit(input: {
		idempotencyKey: string;
		householdId: string | null;
		actorUserId: string | null;
		eventType: string;
		occurredAt: string;
		safeDetails?: Readonly<Record<string, string | number | boolean | null>>;
	}): Promise<void> {
		await this.auditStatement(input).run();
	}

	private subscriptionUpsertStatement(
		projection: SubscriptionProjectionWrite,
		updatedAt: string
	): D1PreparedStatement {
		return this.database
			.prepare(
				`INSERT INTO billing_subscriptions (
					household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
					subscriber_user_id, status, current_period_end, cancel_at_period_end,
					interruption_started_at, grace_until, last_successful_payment_at,
					last_stripe_event_created_at, last_stripe_event_id, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(household_id) DO UPDATE SET
					stripe_customer_id = excluded.stripe_customer_id,
					stripe_subscription_id = excluded.stripe_subscription_id,
					stripe_price_id = excluded.stripe_price_id,
					subscriber_user_id = COALESCE(excluded.subscriber_user_id, billing_subscriptions.subscriber_user_id),
					status = excluded.status,
					current_period_end = excluded.current_period_end,
					cancel_at_period_end = excluded.cancel_at_period_end,
					interruption_started_at = excluded.interruption_started_at,
					grace_until = excluded.grace_until,
					last_successful_payment_at = COALESCE(excluded.last_successful_payment_at, billing_subscriptions.last_successful_payment_at),
					last_stripe_event_created_at = excluded.last_stripe_event_created_at,
					last_stripe_event_id = excluded.last_stripe_event_id,
					updated_at = excluded.updated_at
				WHERE billing_subscriptions.last_stripe_event_created_at IS NULL
					OR excluded.last_stripe_event_created_at > billing_subscriptions.last_stripe_event_created_at
					OR (excluded.last_stripe_event_created_at = billing_subscriptions.last_stripe_event_created_at
						AND excluded.last_stripe_event_id > COALESCE(billing_subscriptions.last_stripe_event_id, ''))`
			)
			.bind(
				projection.householdId,
				projection.stripeCustomerId,
				projection.stripeSubscriptionId,
				projection.stripePriceId,
				projection.subscriberUserId,
				projection.status,
				projection.currentPeriodEnd,
				projection.cancelAtPeriodEnd ? 1 : 0,
				projection.interruptionStartedAt,
				projection.graceUntil,
				projection.lastSuccessfulPaymentAt,
				projection.eventCreatedAt,
				projection.eventId,
				updatedAt
			);
	}

	private auditStatement(input: {
		idempotencyKey: string;
		householdId: string | null;
		actorUserId: string | null;
		eventType: string;
		occurredAt: string;
		safeDetails?: Readonly<Record<string, string | number | boolean | null>>;
	}): D1PreparedStatement {
		return this.database
			.prepare(
				`INSERT INTO billing_audit_events (id, idempotency_key, household_id, actor_user_id, event_type, safe_details, occurred_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`
			)
			.bind(
				crypto.randomUUID(),
				input.idempotencyKey,
				input.householdId,
				input.actorUserId,
				input.eventType,
				JSON.stringify(input.safeDetails ?? {}),
				input.occurredAt
			);
	}
}

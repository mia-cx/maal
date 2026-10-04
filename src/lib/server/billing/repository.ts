import { and, eq, gte, or } from 'drizzle-orm';

import type { StripeSubscriptionStatus } from '$lib/domain/billing/contracts.js';
import { getDb } from '$lib/server/db/index.js';
import {
	billingSubscriptions,
	billingTrialClaims,
	householdDeletionRequests,
	householdMemberships,
	stripeEvents
} from '$lib/server/db/schema/index.js';

export type BillingSubscriptionRow = typeof billingSubscriptions.$inferSelect;
export type BillingTrialClaimRow = typeof billingTrialClaims.$inferSelect;
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

const HOUSEHOLD_PURGE_CLAIM_CODE = 'purge_claimed';

const HOUSEHOLD_PURGE_STATEMENTS = [
	`DELETE FROM meal_instruction_events WHERE rowid IN (
		SELECT event.rowid FROM meal_instruction_events event
		JOIN meal_instructions instruction ON instruction.id = event.meal_instruction_id
		JOIN meals meal ON meal.id = instruction.meal_id
		WHERE meal.household_id = ?1 ORDER BY event.rowid LIMIT ?2
	)`,
	...[
		'meal_appliance_requirements',
		'meal_classifications',
		'meal_ingredients',
		'meal_instructions',
		'meal_media',
		'meal_nutrition_facts'
	].map(
		(table) =>
			`DELETE FROM ${table} WHERE rowid IN (
				SELECT child.rowid FROM ${table} child JOIN meals meal ON meal.id = child.meal_id
				WHERE meal.household_id = ?1 ORDER BY child.rowid LIMIT ?2
			)`
	),
	`DELETE FROM meal_check_ins WHERE rowid IN (
		SELECT check_in.rowid FROM meal_check_ins check_in
		WHERE check_in.household_id = ?1 OR check_in.meal_id IN (
			SELECT id FROM meals WHERE household_id = ?1
		) ORDER BY check_in.rowid LIMIT ?2
	)`,
	`DELETE FROM meal_check_in_recovery WHERE rowid IN (
		SELECT rowid FROM meal_check_in_recovery
		WHERE household_id = ?1 ORDER BY rowid LIMIT ?2
	)`,
	...[
		'meals',
		'household_appliances',
		'household_invites',
		'household_membership_mutation_locks',
		'household_memberships',
		'food_household_aliases',
		'food_household_entries',
		'household_food_display_overrides',
		'household_unit_display_overrides',
		'unit_household_aliases',
		'unit_household_entries',
		'mcp_key_households',
		'billing_subscriptions'
	].map(
		(table) =>
			`DELETE FROM ${table} WHERE rowid IN (
				SELECT rowid FROM ${table} WHERE household_id = ?1 ORDER BY rowid LIMIT ?2
			)`
	),
	...[
		'sync_mutation_receipts',
		'sync_changes',
		'sync_entity_versions',
		'sync_tombstones',
		'sync_scope_state'
	].map(
		(table) =>
			`DELETE FROM ${table} WHERE rowid IN (
				SELECT rowid FROM ${table}
				WHERE audience_kind = 'household' AND audience_id = ?1 ORDER BY rowid LIMIT ?2
			)`
	)
] as const;

const boundedSize = (size: number): number => {
	if (!Number.isSafeInteger(size) || size < 1 || size > 500) {
		throw new TypeError('Household purge batch size must be between 1 and 500.');
	}
	return size;
};

export class BillingRepository {
	constructor(readonly database: D1Database) {}

	async subscription(householdId: string): Promise<BillingSubscriptionRow | null> {
		return (
			(
				await getDb(this.database)
					.select()
					.from(billingSubscriptions)
					.where(eq(billingSubscriptions.householdId, householdId))
					.limit(1)
			)[0] ?? null
		);
	}

	async subscriptionByStripeId(subscriptionId: string): Promise<BillingSubscriptionRow | null> {
		return (
			(
				await getDb(this.database)
					.select()
					.from(billingSubscriptions)
					.where(eq(billingSubscriptions.stripeSubscriptionId, subscriptionId))
					.limit(1)
			)[0] ?? null
		);
	}

	async trialClaimAvailability(
		workosUserId: string,
		householdId: string
	): Promise<'available' | 'user_already_claimed' | 'household_already_claimed'> {
		const rows = await getDb(this.database)
			.select({
				workosUserId: billingTrialClaims.workosUserId,
				householdId: billingTrialClaims.householdId
			})
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
		await getDb(this.database)
			.insert(billingTrialClaims)
			.values({
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

	async recordTrialResources(input: {
		id: string;
		stripeCustomerId: string | null;
		stripeSubscriptionId: string | null;
		updatedAt: string;
	}): Promise<void> {
		await this.database
			.prepare(
				`UPDATE billing_trial_claims
				 SET stripe_customer_id = COALESCE(?, stripe_customer_id),
				     stripe_subscription_id = COALESCE(?, stripe_subscription_id), updated_at = ?
				 WHERE id = ? AND state = 'reserved'`
			)
			.bind(input.stripeCustomerId, input.stripeSubscriptionId, input.updatedAt, input.id)
			.run();
	}

	async staleTrialClaims(
		staleBefore: string,
		limit = 25
	): Promise<readonly BillingTrialClaimRow[]> {
		const size = boundedSize(limit);
		return (
			await this.database
				.prepare(
					`SELECT id, workos_user_id AS workosUserId, household_id AS householdId, state,
					 stripe_customer_id AS stripeCustomerId,
					 stripe_subscription_id AS stripeSubscriptionId, reserved_at AS reservedAt,
					 started_at AS startedAt, updated_at AS updatedAt
					 FROM billing_trial_claims
					 WHERE state IN ('reserved', 'rollback_pending') AND updated_at <= ?
					 ORDER BY updated_at, id LIMIT ?`
				)
				.bind(staleBefore, size)
				.all<BillingTrialClaimRow>()
		).results;
	}

	async releaseStaleTrialReservation(id: string, staleBefore: string): Promise<boolean> {
		const result = await this.database
			.prepare(
				`DELETE FROM billing_trial_claims
				 WHERE id = ? AND state = 'reserved' AND stripe_customer_id IS NULL
				 AND stripe_subscription_id IS NULL AND updated_at <= ?`
			)
			.bind(id, staleBefore)
			.run();
		return result.meta.changes > 0;
	}

	async releaseTrialClaimAfterRollback(id: string): Promise<boolean> {
		const result = await this.database
			.prepare(
				`DELETE FROM billing_trial_claims
				 WHERE id = ? AND state IN ('reserved', 'rollback_pending')
				 AND stripe_subscription_id IS NULL`
			)
			.bind(id)
			.run();
		return result.meta.changes > 0;
	}

	async completeTrialRollback(id: string, resolvedAt: string): Promise<boolean> {
		const result = await this.database
			.prepare(
				`UPDATE billing_trial_claims
				 SET state = 'started', started_at = COALESCE(started_at, reserved_at), updated_at = ?
				 WHERE id = ? AND state IN ('reserved', 'rollback_pending')
				 AND stripe_subscription_id IS NOT NULL`
			)
			.bind(resolvedAt, id)
			.run();
		return result.meta.changes > 0;
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
				.bind(
					p.stripeCustomerId,
					p.stripeSubscriptionId,
					input.startedAt,
					input.startedAt,
					input.claimId
				),
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
			.prepare(
				'UPDATE stripe_events SET attempts = attempts + 1, state = ? WHERE stripe_event_id = ?'
			)
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
			.prepare(
				`UPDATE stripe_events SET state = 'failed', safe_error_code = ? WHERE stripe_event_id = ?`
			)
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
			(
				await getDb(this.database)
					.select()
					.from(householdDeletionRequests)
					.where(eq(householdDeletionRequests.householdId, householdId))
					.limit(1)
			)[0] ?? null
		);
	}

	async deletionRequestByRefundId(refundId: string): Promise<HouseholdDeletionRow | null> {
		return (
			(
				await getDb(this.database)
					.select()
					.from(householdDeletionRequests)
					.where(eq(householdDeletionRequests.stripeRefundId, refundId))
					.limit(1)
			)[0] ?? null
		);
	}

	async outstandingDeletionRefunds(limit = 10): Promise<readonly HouseholdDeletionRow[]> {
		const size = boundedSize(limit);
		return (
			await getDb(this.database)
				.select()
				.from(householdDeletionRequests)
				.where(eq(householdDeletionRequests.state, 'refunding'))
				.limit(size)
		).filter(({ stripeRefundId }) => stripeRefundId !== null);
	}

	async upsertDeletionRequest(input: typeof householdDeletionRequests.$inferInsert): Promise<void> {
		await getDb(this.database).insert(householdDeletionRequests).values(input).onConflictDoUpdate({
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

	async claimExpiredRecoverableHouseholds(now: string, limit = 10): Promise<string[]> {
		const size = boundedSize(limit);
		const rows = await this.database
			.prepare(
				`UPDATE household_deletion_requests
				 SET state = 'requested', safe_error_code = ?, updated_at = ?
				 WHERE household_id IN (
				  SELECT household_id FROM household_deletion_requests
				  WHERE state = 'recoverable' AND recoverable_until <= ?
				  ORDER BY recoverable_until, household_id LIMIT ?
				 ) RETURNING household_id`
			)
			.bind(HOUSEHOLD_PURGE_CLAIM_CODE, now, now, size)
			.all<{ household_id: string }>();
		return rows.results.map(({ household_id }) => household_id);
	}

	async claimedHouseholdPurges(now: string, limit = 10): Promise<string[]> {
		const size = boundedSize(limit);
		return (
			await this.database
				.prepare(
					`SELECT household_id FROM household_deletion_requests
					 WHERE state = 'requested' AND safe_error_code = ? AND recoverable_until <= ?
					 ORDER BY recoverable_until, household_id LIMIT ?`
				)
				.bind(HOUSEHOLD_PURGE_CLAIM_CODE, now, size)
				.all<{ household_id: string }>()
		).results.map(({ household_id }) => household_id);
	}

	async purgeHouseholdContentBatch(
		householdId: string,
		purgedAt: string,
		batchSize = 100
	): Promise<{ complete: boolean; rowsDeleted: number }> {
		const size = boundedSize(batchSize);
		const claim = await this.database
			.prepare(
				`SELECT 1 AS present FROM household_deletion_requests
				 WHERE household_id = ? AND state = 'requested' AND safe_error_code = ?
				  AND recoverable_until <= ?`
			)
			.bind(householdId, HOUSEHOLD_PURGE_CLAIM_CODE, purgedAt)
			.first<{ present: number }>();
		if (!claim) return { complete: false, rowsDeleted: 0 };

		let remaining = size;
		let rowsDeleted = 0;
		for (const statement of HOUSEHOLD_PURGE_STATEMENTS) {
			const result = await this.database.prepare(statement).bind(householdId, remaining).run();
			rowsDeleted += result.meta.changes;
			remaining -= result.meta.changes;
			if (remaining === 0) return { complete: false, rowsDeleted };
		}

		const detached = await this.database
			.prepare(
				`UPDATE recipes SET saved_from_household_id = NULL WHERE rowid IN (
				 SELECT rowid FROM recipes WHERE saved_from_household_id = ? ORDER BY rowid LIMIT ?
				)`
			)
			.bind(householdId, remaining)
			.run();
		rowsDeleted += detached.meta.changes;
		remaining -= detached.meta.changes;
		if (remaining === 0) return { complete: false, rowsDeleted };

		await this.database.batch([
			this.database.prepare('DELETE FROM households WHERE household_id = ?').bind(householdId),
			this.database
				.prepare(
					`UPDATE household_deletion_requests SET state = 'purged', purged_at = ?,
					 updated_at = ?, safe_error_code = NULL WHERE household_id = ? AND state = 'requested'
					 AND safe_error_code = ?`
				)
				.bind(purgedAt, purgedAt, householdId, HOUSEHOLD_PURGE_CLAIM_CODE),
			this.auditStatement({
				idempotencyKey: `household:${householdId}:purged`,
				householdId,
				actorUserId: null,
				eventType: 'household_purged_after_recovery_window',
				occurredAt: purgedAt
			})
		]);
		return { complete: true, rowsDeleted };
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
						AND excluded.updated_at > billing_subscriptions.updated_at)
					OR (excluded.last_stripe_event_created_at = billing_subscriptions.last_stripe_event_created_at
						AND excluded.updated_at = billing_subscriptions.updated_at
						AND (
							CASE excluded.status
								WHEN 'active' THEN 0 WHEN 'trialing' THEN 0
								WHEN 'past_due' THEN 1 WHEN 'paused' THEN 1 ELSE 2 END
							>
							CASE billing_subscriptions.status
								WHEN 'active' THEN 0 WHEN 'trialing' THEN 0
								WHEN 'past_due' THEN 1 WHEN 'paused' THEN 1 ELSE 2 END
							OR (
								CASE excluded.status
									WHEN 'active' THEN 0 WHEN 'trialing' THEN 0
									WHEN 'past_due' THEN 1 WHEN 'paused' THEN 1 ELSE 2 END
								=
								CASE billing_subscriptions.status
									WHEN 'active' THEN 0 WHEN 'trialing' THEN 0
									WHEN 'past_due' THEN 1 WHEN 'paused' THEN 1 ELSE 2 END
								AND excluded.last_stripe_event_id > COALESCE(billing_subscriptions.last_stripe_event_id, '')
							)
						))`
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

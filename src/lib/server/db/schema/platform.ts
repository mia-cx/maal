import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { createdAt, enumCheck, nonNegative, updatedAt } from './common.js';
import {
	deletionRequestStateValues,
	mcpGrantModeValues,
	mcpPresetValues,
	stripeEventStateValues,
	syncAudienceKindValues,
	syncOperationValues,
	trialClaimStateValues
} from './enums.js';
import { households, users } from './identity.js';

export const stripeSubscriptionStatusValues = [
	'incomplete',
	'incomplete_expired',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused'
] as const;

export const billingSubscriptions = sqliteTable(
	'billing_subscriptions',
	{
		householdId: text('household_id')
			.primaryKey()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		stripeCustomerId: text('stripe_customer_id').notNull(),
		stripeSubscriptionId: text('stripe_subscription_id').notNull(),
		stripePriceId: text('stripe_price_id').notNull(),
		subscriberUserId: text('subscriber_user_id').references(() => users.workosUserId, {
			onDelete: 'set null'
		}),
		status: text('status', { enum: stripeSubscriptionStatusValues }).notNull(),
		currentPeriodEnd: text('current_period_end').notNull(),
		cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
			.notNull()
			.default(false),
		interruptionStartedAt: text('interruption_started_at'),
		graceUntil: text('grace_until'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('billing_subscriptions_subscription_unique').on(table.stripeSubscriptionId),
		index('billing_subscriptions_customer_idx').on(table.stripeCustomerId),
		index('billing_subscriptions_subscriber_idx').on(table.subscriberUserId),
		enumCheck('billing_subscriptions_status_check', table.status, stripeSubscriptionStatusValues)
	]
);

export const billingTrialClaims = sqliteTable(
	'billing_trial_claims',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id').notNull(),
		householdId: text('household_id').notNull(),
		state: text('state', { enum: trialClaimStateValues }).notNull(),
		stripeCustomerId: text('stripe_customer_id'),
		stripeSubscriptionId: text('stripe_subscription_id'),
		reservedAt: text('reserved_at').notNull(),
		startedAt: text('started_at'),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('billing_trial_claims_user_unique').on(table.workosUserId),
		uniqueIndex('billing_trial_claims_household_unique').on(table.householdId),
		enumCheck('billing_trial_claims_state_check', table.state, trialClaimStateValues),
		check(
			'billing_trial_claims_started_at_check',
			sql`${table.state} != 'started' OR ${table.startedAt} IS NOT NULL`
		)
	]
);

export const stripeEvents = sqliteTable(
	'stripe_events',
	{
		stripeEventId: text('stripe_event_id').primaryKey(),
		type: text('type').notNull(),
		state: text('state', { enum: stripeEventStateValues }).notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		receivedAt: text('received_at').notNull(),
		processedAt: text('processed_at'),
		safeErrorCode: text('safe_error_code')
	},
	(table) => [
		enumCheck('stripe_events_state_check', table.state, stripeEventStateValues),
		check('stripe_events_attempts_nonnegative', nonNegative(table.attempts)),
		index('stripe_events_processing_idx').on(table.state, table.receivedAt)
	]
);

export const householdDeletionRequests = sqliteTable(
	'household_deletion_requests',
	{
		householdId: text('household_id').primaryKey(),
		requesterUserId: text('requester_user_id').notNull(),
		state: text('state', { enum: deletionRequestStateValues }).notNull(),
		stripeCancellationId: text('stripe_cancellation_id'),
		stripeRefundId: text('stripe_refund_id'),
		previewedAmountMinor: integer('previewed_amount_minor'),
		refundedAmountMinor: integer('refunded_amount_minor'),
		currency: text('currency'),
		requestedAt: text('requested_at').notNull(),
		recoverableUntil: text('recoverable_until'),
		purgedAt: text('purged_at'),
		safeErrorCode: text('safe_error_code'),
		updatedAt: updatedAt()
	},
	(table) => [
		enumCheck('household_deletion_requests_state_check', table.state, deletionRequestStateValues),
		check(
			'household_deletion_requests_preview_amount_nonnegative',
			sql`${table.previewedAmountMinor} IS NULL OR ${table.previewedAmountMinor} >= 0`
		),
		check(
			'household_deletion_requests_refund_amount_nonnegative',
			sql`${table.refundedAmountMinor} IS NULL OR ${table.refundedAmountMinor} >= 0`
		),
		index('household_deletion_requests_recovery_idx').on(table.state, table.recoverableUntil)
	]
);

export const billingAuditEvents = sqliteTable(
	'billing_audit_events',
	{
		id: text('id').primaryKey(),
		idempotencyKey: text('idempotency_key').notNull(),
		householdId: text('household_id'),
		actorUserId: text('actor_user_id'),
		eventType: text('event_type').notNull(),
		safeDetails: text('safe_details').notNull().default('{}'),
		occurredAt: text('occurred_at').notNull()
	},
	(table) => [
		uniqueIndex('billing_audit_events_idempotency_unique').on(table.idempotencyKey),
		index('billing_audit_events_household_time_idx').on(table.householdId, table.occurredAt),
		check('billing_audit_events_safe_details_json_check', sql`json_valid(${table.safeDetails})`)
	]
);

export const mcpKeys = sqliteTable(
	'mcp_keys',
	{
		id: text('id').primaryKey(),
		ownerUserId: text('owner_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		keyHash: text('key_hash').notNull(),
		label: text('label').notNull(),
		preset: text('preset', { enum: mcpPresetValues }),
		grantMode: text('grant_mode', { enum: mcpGrantModeValues }).notNull(),
		scopes: text('scopes').notNull(),
		createdAt: createdAt(),
		expiresAt: text('expires_at'),
		revokedAt: text('revoked_at'),
		lastUsedAt: text('last_used_at')
	},
	(table) => [
		uniqueIndex('mcp_keys_hash_unique').on(table.keyHash),
		index('mcp_keys_owner_idx').on(table.ownerUserId),
		check(
			'mcp_keys_preset_check',
			sql`${table.preset} IS NULL OR ${table.preset} IN ('read_only_planner', 'meal_planner', 'full_access')`
		),
		enumCheck('mcp_keys_grant_mode_check', table.grantMode, mcpGrantModeValues),
		check('mcp_keys_scopes_json_check', sql`json_valid(${table.scopes})`)
	]
);

export const mcpKeyHouseholds = sqliteTable(
	'mcp_key_households',
	{
		keyId: text('key_id')
			.notNull()
			.references(() => mcpKeys.id, { onDelete: 'cascade' }),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.keyId, table.householdId] })]
);

export const syncChanges = sqliteTable(
	'sync_changes',
	{
		seq: integer('seq').primaryKey({ autoIncrement: true }),
		mutationId: text('mutation_id').notNull(),
		actorUserId: text('actor_user_id').notNull(),
		originDeviceId: text('origin_device_id').notNull(),
		audienceKind: text('audience_kind', { enum: syncAudienceKindValues }).notNull(),
		audienceId: text('audience_id').notNull(),
		entityKind: text('entity_kind').notNull(),
		entityId: text('entity_id').notNull(),
		conflictGroup: text('conflict_group').notNull(),
		operation: text('operation', { enum: syncOperationValues }).notNull(),
		resultingRevision: integer('resulting_revision').notNull(),
		occurredAt: text('occurred_at').notNull(),
		receivedAt: text('received_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		payload: text('payload').notNull(),
		tombstoneExpiresAt: text('tombstone_expires_at')
	},
	(table) => [
		uniqueIndex('sync_changes_mutation_unique').on(table.mutationId),
		index('sync_changes_audience_seq_idx').on(table.audienceKind, table.audienceId, table.seq),
		index('sync_changes_entity_idx').on(table.entityKind, table.entityId),
		enumCheck('sync_changes_audience_kind_check', table.audienceKind, syncAudienceKindValues),
		enumCheck('sync_changes_operation_check', table.operation, syncOperationValues),
		check('sync_changes_revision_positive', sql`${table.resultingRevision} > 0`),
		check('sync_changes_payload_json_check', sql`json_valid(${table.payload})`)
	]
);

export const syncEntityVersions = sqliteTable(
	'sync_entity_versions',
	{
		audienceKind: text('audience_kind', { enum: syncAudienceKindValues }).notNull(),
		audienceId: text('audience_id').notNull(),
		entityKind: text('entity_kind').notNull(),
		entityId: text('entity_id').notNull(),
		conflictGroup: text('conflict_group').notNull(),
		revision: integer('revision').notNull(),
		lastSequence: integer('last_sequence').notNull(),
		winningOccurredAt: text('winning_occurred_at').notNull(),
		winningOriginDeviceId: text('winning_origin_device_id').notNull(),
		winningMutationId: text('winning_mutation_id').notNull()
	},
	(table) => [
		primaryKey({
			columns: [
				table.audienceKind,
				table.audienceId,
				table.entityKind,
				table.entityId,
				table.conflictGroup
			]
		}),
		enumCheck(
			'sync_entity_versions_audience_kind_check',
			table.audienceKind,
			syncAudienceKindValues
		),
		check('sync_entity_versions_revision_positive', sql`${table.revision} > 0`),
		check('sync_entity_versions_sequence_positive', sql`${table.lastSequence} > 0`)
	]
);

export const syncDevices = sqliteTable(
	'sync_devices',
	{
		deviceId: text('device_id').notNull(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		displayName: text('display_name'),
		createdAt: createdAt(),
		lastSeenAt: text('last_seen_at').notNull(),
		lastAppVersion: text('last_app_version').notNull(),
		lastProtocolVersion: integer('last_protocol_version').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.deviceId, table.workosUserId] }),
		index('sync_devices_user_seen_idx').on(table.workosUserId, table.lastSeenAt),
		check('sync_devices_protocol_version_positive', sql`${table.lastProtocolVersion} > 0`)
	]
);

export const syncScopeState = sqliteTable(
	'sync_scope_state',
	{
		audienceKind: text('audience_kind', { enum: syncAudienceKindValues }).notNull(),
		audienceId: text('audience_id').notNull(),
		bootstrapGeneration: integer('bootstrap_generation').notNull().default(1),
		earliestRetainedSequence: integer('earliest_retained_sequence').notNull().default(0),
		latestSequence: integer('latest_sequence').notNull().default(0),
		updatedAt: updatedAt()
	},
	(table) => [
		primaryKey({ columns: [table.audienceKind, table.audienceId] }),
		enumCheck('sync_scope_state_audience_kind_check', table.audienceKind, syncAudienceKindValues),
		check('sync_scope_state_generation_positive', sql`${table.bootstrapGeneration} > 0`),
		check('sync_scope_state_floor_nonnegative', nonNegative(table.earliestRetainedSequence)),
		check('sync_scope_state_latest_nonnegative', nonNegative(table.latestSequence)),
		check(
			'sync_scope_state_sequence_order_check',
			sql`${table.earliestRetainedSequence} <= ${table.latestSequence}`
		)
	]
);

export const syncTombstones = sqliteTable(
	'sync_tombstones',
	{
		audienceKind: text('audience_kind', { enum: syncAudienceKindValues }).notNull(),
		audienceId: text('audience_id').notNull(),
		entityKind: text('entity_kind').notNull(),
		entityId: text('entity_id').notNull(),
		deletionSequence: integer('deletion_sequence').notNull(),
		deletedAt: text('deleted_at').notNull(),
		expiresAt: text('expires_at').notNull(),
		previousServerAck: integer('previous_server_ack', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [
		primaryKey({
			columns: [table.audienceKind, table.audienceId, table.entityKind, table.entityId]
		}),
		index('sync_tombstones_expiry_idx').on(table.expiresAt),
		enumCheck('sync_tombstones_audience_kind_check', table.audienceKind, syncAudienceKindValues),
		check('sync_tombstones_sequence_positive', sql`${table.deletionSequence} > 0`)
	]
);

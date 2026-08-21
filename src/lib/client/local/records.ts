import type { ConflictClocks, ScopeKind, UtcInstant } from '$lib/domain/contracts/primitives.js';

export interface MetaRecord {
	key: string;
	value: unknown;
	updatedAt: UtcInstant;
}

export interface ProfileRecord {
	profileId: string;
	workosUserId: string;
	displayName: string;
	email: string | null;
	locale: string;
	timezone: string | null;
	pinSalt: string | null;
	pinVerifier: string | null;
	lockPolicy: 'none' | 'pin';
	lastUsedAt: UtcInstant;
	authState: 'authenticated' | 'reauthRequired' | 'signedOut';
}

export interface AuthSlotRecord {
	authSlotId: string;
	profileId: string;
	workosUserId: string;
	sessionState: 'authenticated' | 'reauthRequired' | 'revoked';
	lastRefreshedAt: UtcInstant | null;
	lastVerifiedAt: UtcInstant | null;
	nextRetryAt: UtcInstant | null;
	retryCount: number;
}

export interface HouseholdRecord {
	[key: string]: unknown;
	householdId: string;
	createdByUserId?: string | null;
	deletionState?: string;
}

export interface MembershipRecord {
	[key: string]: unknown;
	membershipId: string;
	householdId: string;
	workosUserId: string;
	status: string;
}

export interface HouseholdInviteRecord extends LocalStoreRecord {
	id: string;
	householdId: string;
	expiresAt: UtcInstant;
	revokedAt: UtcInstant | null;
}

export interface HouseholdApplianceRecord extends LocalStoreRecord {
	id: string;
	householdId: string;
	appliance: string;
}

export interface LocalStoreRecord {
	[key: string]: unknown;
	id: string;
}

export interface LocalAggregateRecord extends LocalStoreRecord {
	schemaVersion: number;
	revision: number;
	createdAt: UtcInstant;
	updatedAt: UtcInstant;
	deletedAt: UtcInstant | null;
	conflictClocks: ConflictClocks;
	ownerUserId?: string;
	householdId?: string;
	date?: string | null;
	status?: string;
	sortOrder?: number | null;
	reporterUserId?: string;
	mealId?: string | null;
	searchTokens?: string[];
}

export interface BillingCapabilityRecord {
	householdId: string;
	status: string;
	validUntil: UtcInstant | null;
	stale: boolean;
	[key: string]: unknown;
}

export interface McpKeySummaryRecord extends LocalStoreRecord {
	ownerUserId: string;
	revokedAt: UtcInstant | null;
}

export type OutboxStatus = 'pending' | 'sending' | 'quarantined' | 'acknowledged' | 'rejected';

export interface OutboxRecord {
	[key: string]: unknown;
	mutationId: string;
	authSlotId: string;
	scopeKind: ScopeKind;
	scopeId: string;
	status: OutboxStatus;
	occurredAt: UtcInstant;
	aggregateId: string;
	entityKind: string;
	conflictGroup: string;
	operation: 'upsert' | 'delete';
	originDeviceId: string;
	payload: unknown;
	nextAttemptAt: UtcInstant;
	attempts: number;
}

export type SyncScopeState = 'idle' | 'syncing' | 'blocked' | 'bootstrapRequired';

export interface SyncScopeRecord {
	scopeKind: ScopeKind;
	scopeId: string;
	cursor: number | null;
	bootstrapGeneration: number | null;
	retainedFloor: number | null;
	state: SyncScopeState;
	leaseOwner: string | null;
	leaseExpiresAt: UtcInstant | null;
	lastSuccessAt: UtcInstant | null;
	lastErrorCode: string | null;
}

export interface BackfillCheckpointRecord {
	scopeKind: ScopeKind;
	scopeId: string;
	entityKind: string;
	priorityBoundary: string | null;
	lastAggregateId: string | null;
	processedCount: number;
	state: 'pending' | 'running' | 'complete';
}

export interface UiStateRecord {
	key: string;
	value: unknown;
}

export interface RemoteProjectionMetaRecord {
	key: string;
	refreshedAt: UtcInstant | null;
	decodeVersion: number;
	value: unknown;
}

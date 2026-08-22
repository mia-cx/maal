import type { ConflictClocks, ScopeKind, UtcInstant } from '$lib/domain/contracts/primitives.js';
import type { BillingCapability } from '$lib/domain/billing/contracts.js';
import type {
	Household,
	HouseholdAppliance,
	HouseholdInviteSummary,
	Membership,
	Profile
} from '$lib/domain/household/contracts.js';

export interface MetaRecord {
	key: string;
	value: unknown;
	updatedAt: UtcInstant;
}

export type ProfileRecord = Profile;

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

export type HouseholdRecord = Household;

export type MembershipRecord = Membership;

export type HouseholdInviteRecord = HouseholdInviteSummary;

export type HouseholdApplianceRecord = HouseholdAppliance;

export interface UserAttributionRecord {
	workosUserId: string;
	displayName: string;
	email?: string | null;
	profilePictureUrl: string | null;
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

export type BillingCapabilityRecord = BillingCapability;

export interface McpKeySummaryRecord extends LocalStoreRecord {
	ownerUserId: string;
	label: string;
	preset: 'read_only_planner' | 'meal_planner' | 'full_access' | null;
	grantMode: 'all' | 'selected';
	scopes: readonly string[];
	selectedHouseholdIds: readonly string[];
	householdScope:
		| { readonly kind: 'all' }
		| { readonly kind: 'households'; readonly householdIds: readonly string[] };
	createdAt: UtcInstant;
	expiresAt: UtcInstant | null;
	revokedAt: UtcInstant | null;
	lastUsedAt: UtcInstant | null;
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
	lastAttemptAt?: UtcInstant | null;
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

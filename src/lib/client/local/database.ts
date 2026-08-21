import Dexie, { type Table } from 'dexie';
import { uuidv7 } from 'uuidv7';

import { LocalMigrationError } from '$lib/domain/contracts/errors.js';

import type {
	AuthSlotRecord,
	BackfillCheckpointRecord,
	BillingCapabilityRecord,
	HouseholdApplianceRecord,
	HouseholdInviteRecord,
	HouseholdRecord,
	LocalAggregateRecord,
	LocalStoreRecord,
	McpKeySummaryRecord,
	MembershipRecord,
	MetaRecord,
	OutboxRecord,
	ProfileRecord,
	RemoteProjectionMetaRecord,
	SyncScopeRecord,
	UiStateRecord
} from './records.js';

export const CURRENT_DATABASE_VERSION = 3 as const;

export const DATABASE_V1_STORES = {
	meta: '&key',
	profiles: '&profileId,&workosUserId,lastUsedAt,authState',
	households: '&householdId,createdByUserId,deletionState',
	recipes: '&id,ownerUserId,deletedAt,updatedAt,*searchTokens',
	meals:
		'&id,householdId,[householdId+date],[householdId+status],[householdId+date+sortOrder],deletedAt',
	mealCheckIns: '&id,&[mealId+reporterUserId],mealId,reporterUserId,deletedAt',
	outbox:
		'&mutationId,[authSlotId+status+occurredAt],[scopeKind+scopeId+status],aggregateId,nextAttemptAt',
	uiState: '&key'
} as const;

export const DATABASE_STORES = {
	...DATABASE_V1_STORES,
	authSlots: '&authSlotId,&profileId,workosUserId,sessionState',
	memberships:
		'&membershipId,&[householdId+workosUserId],[workosUserId+status],[householdId+status]',
	householdInvites: '&id,householdId,expiresAt,revokedAt',
	householdAppliances: '&id,&[householdId+appliance]',
	foods: '&id',
	foodAliases: '&id,foodId,[foodId+locale],[locale+alias],[sourceDomain+locale+alias]',
	foodUserAliases:
		'&id,workosUserId,foodId,&[workosUserId+foodId+locale+alias],[workosUserId+locale+alias],adoptionStatus',
	foodHouseholdAliases:
		'&id,householdId,foodId,&[householdId+foodId+locale+alias],[householdId+locale+alias],adoptionStatus',
	foodUserEntries: '&id,workosUserId,&[workosUserId+canonicalLabel],adoptionStatus',
	foodHouseholdEntries: '&id,householdId,&[householdId+canonicalLabel],adoptionStatus',
	units: '&id,&[id+baseUnitId],baseUnitId',
	unitAliases:
		'&id,unitId,baseUnitId,[baseUnitId+locale],[locale+alias],[sourceDomain+locale+alias]',
	unitUserAliases:
		'&id,workosUserId,unitId,baseUnitId,&[workosUserId+baseUnitId+locale+alias],[workosUserId+locale+alias],adoptionStatus',
	unitHouseholdAliases:
		'&id,householdId,unitId,baseUnitId,&[householdId+baseUnitId+locale+alias],[householdId+locale+alias],adoptionStatus',
	unitUserEntries: '&id,workosUserId,baseUnitId,&[workosUserId+canonicalLabel],adoptionStatus',
	unitHouseholdEntries: '&id,householdId,baseUnitId,&[householdId+canonicalLabel],adoptionStatus',
	userFoodPreferences: '&id,&[workosUserId+foodId],workosUserId,foodId',
	userFoodDisplayPreferences: '&id,&[workosUserId+foodId+locale],workosUserId,foodId',
	householdFoodDisplayPreferences: '&id,&[householdId+foodId+locale],householdId,foodId',
	userUnitDisplayPreferences: '&id,&[workosUserId+baseUnitId+locale],workosUserId,baseUnitId',
	householdUnitDisplayPreferences: '&id,&[householdId+baseUnitId+locale],householdId,baseUnitId',
	billingCapabilities: '&householdId,status,validUntil,stale',
	mcpKeySummaries: '&id,ownerUserId,revokedAt',
	syncScopes: '&[scopeKind+scopeId],state,leaseExpiresAt,lastSuccessAt',
	backfillCheckpoints: '&[scopeKind+scopeId+entityKind],state',
	remoteProjectionMeta: '&key'
} as const;

export type LocalStoreName = keyof typeof DATABASE_STORES;

export const getMaalDatabaseName = (environment: string): string => {
	const normalized = environment.trim();
	if (normalized.length === 0 || normalized.includes(':')) {
		throw new TypeError('The database environment must be a non-empty name without a colon.');
	}
	return `maal-v1:${normalized}`;
};

const nowUtc = (): `${string}Z` => new Date().toISOString() as `${string}Z`;

export class MaalDatabase extends Dexie {
	meta!: Table<MetaRecord, string>;
	profiles!: Table<ProfileRecord, string>;
	authSlots!: Table<AuthSlotRecord, string>;
	households!: Table<HouseholdRecord, string>;
	memberships!: Table<MembershipRecord, string>;
	householdInvites!: Table<HouseholdInviteRecord, string>;
	householdAppliances!: Table<HouseholdApplianceRecord, string>;
	recipes!: Table<LocalAggregateRecord, string>;
	meals!: Table<LocalAggregateRecord, string>;
	mealCheckIns!: Table<LocalAggregateRecord, string>;
	foods!: Table<LocalStoreRecord, string>;
	foodAliases!: Table<LocalStoreRecord, string>;
	foodUserAliases!: Table<LocalStoreRecord, string>;
	foodHouseholdAliases!: Table<LocalStoreRecord, string>;
	foodUserEntries!: Table<LocalStoreRecord, string>;
	foodHouseholdEntries!: Table<LocalStoreRecord, string>;
	units!: Table<LocalStoreRecord, string>;
	unitAliases!: Table<LocalStoreRecord, string>;
	unitUserAliases!: Table<LocalStoreRecord, string>;
	unitHouseholdAliases!: Table<LocalStoreRecord, string>;
	unitUserEntries!: Table<LocalStoreRecord, string>;
	unitHouseholdEntries!: Table<LocalStoreRecord, string>;
	userFoodPreferences!: Table<LocalStoreRecord, string>;
	userFoodDisplayPreferences!: Table<LocalStoreRecord, string>;
	householdFoodDisplayPreferences!: Table<LocalStoreRecord, string>;
	userUnitDisplayPreferences!: Table<LocalStoreRecord, string>;
	householdUnitDisplayPreferences!: Table<LocalStoreRecord, string>;
	billingCapabilities!: Table<BillingCapabilityRecord, string>;
	mcpKeySummaries!: Table<McpKeySummaryRecord, string>;
	outbox!: Table<OutboxRecord, string>;
	syncScopes!: Table<SyncScopeRecord, [string, string]>;
	backfillCheckpoints!: Table<BackfillCheckpointRecord, [string, string, string]>;
	uiState!: Table<UiStateRecord, string>;
	remoteProjectionMeta!: Table<RemoteProjectionMetaRecord, string>;

	constructor(environment: string) {
		super(getMaalDatabaseName(environment));

		this.version(1).stores(DATABASE_V1_STORES);
		this.version(2)
			.stores(DATABASE_STORES)
			.upgrade(async (transaction) => {
				const timestamp = nowUtc();
				await transaction.table<MetaRecord, string>('meta').bulkPut([
					{
						key: 'migrationState',
						value: { from: 1, to: 2, state: 'complete' },
						updatedAt: timestamp
					},
					{
						key: 'databaseVersion',
						value: 2,
						updatedAt: timestamp
					}
				]);
			});
		this.version(CURRENT_DATABASE_VERSION)
			.stores(DATABASE_STORES)
			.upgrade(async (transaction) => {
				const timestamp = nowUtc();
				await transaction
					.table<ProfileRecord, string>('profiles')
					.toCollection()
					.modify((profile) => {
						const mutable = profile as { profilePictureUrl?: string | null };
						mutable.profilePictureUrl ??= null;
					});
				await transaction
					.table<HouseholdRecord, string>('households')
					.toCollection()
					.modify((household) => {
						const mutable = household as unknown as Record<string, unknown>;
						mutable.name ??= 'Household';
						mutable.locale ??= 'en-US';
						mutable.timezone ??= null;
						mutable.weekStartsOn ??= 1;
						mutable.defaultPlannedYield ??= 1;
						mutable.preferredDinnerTime ??= null;
						mutable.createdByUserId ??= null;
						mutable.deletionState ??= 'active';
						mutable.localOnly ??= false;
						mutable.schemaVersion ??= 1;
						mutable.revision ??= 0;
						mutable.createdAt ??= timestamp;
						mutable.updatedAt ??= timestamp;
						mutable.deletedAt ??= null;
						mutable.conflictClocks ??= {};
					});
				await transaction.table<MetaRecord, string>('meta').bulkPut([
					{
						key: 'migrationState',
						value: { from: 2, to: CURRENT_DATABASE_VERSION, state: 'complete' },
						updatedAt: timestamp
					},
					{
						key: 'databaseVersion',
						value: CURRENT_DATABASE_VERSION,
						updatedAt: timestamp
					}
				]);
			});

		this.on('populate', (transaction) => {
			const timestamp = nowUtc();
			return transaction.table<MetaRecord, string>('meta').bulkPut([
				{ key: 'databaseVersion', value: CURRENT_DATABASE_VERSION, updatedAt: timestamp },
				{ key: 'contractVersion', value: 1, updatedAt: timestamp },
				{ key: 'deviceId', value: uuidv7(), updatedAt: timestamp },
				{ key: 'recoveryState', value: { state: 'ready' }, updatedAt: timestamp }
			]);
		});

		this.on('versionchange', () => this.close());
	}
}

export const openMaalDatabase = async (environment: string): Promise<MaalDatabase> => {
	const database = new MaalDatabase(environment);
	try {
		await database.open();
		const timestamp = nowUtc();
		await database.transaction('rw', database.meta, async () => {
			const existing = new Set((await database.meta.toCollection().primaryKeys()) as string[]);
			const records: MetaRecord[] = [];
			if (!existing.has('databaseVersion')) {
				records.push({
					key: 'databaseVersion',
					value: CURRENT_DATABASE_VERSION,
					updatedAt: timestamp
				});
			}
			if (!existing.has('contractVersion')) {
				records.push({ key: 'contractVersion', value: 1, updatedAt: timestamp });
			}
			if (!existing.has('deviceId')) {
				records.push({ key: 'deviceId', value: uuidv7(), updatedAt: timestamp });
			}
			if (!existing.has('recoveryState')) {
				records.push({ key: 'recoveryState', value: { state: 'ready' }, updatedAt: timestamp });
			}
			if (records.length > 0) await database.meta.bulkPut(records);
		});
		return database;
	} catch {
		database.close();
		throw new LocalMigrationError({
			operation: 'open local database',
			message: 'The local database could not be migrated. Recovery is required.'
		});
	}
};

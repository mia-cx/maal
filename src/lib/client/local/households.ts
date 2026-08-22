import { Data, Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { DomainIdSchema, UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import {
	HouseholdAppliancePatchSchema,
	HouseholdApplianceSchema,
	HouseholdSchema,
	HouseholdSettingsPatchSchema,
	MembershipSchema,
	type Household,
	type HouseholdAppliancePatch,
	type HouseholdPermission,
	type HouseholdSettingsPatch,
	type Membership,
	type Profile
} from '$lib/domain/household/contracts.js';
import { requireCachedPermission } from '$lib/domain/household/permissions.js';

import { executeLocalCommand } from './commands.js';
import type { MaalDatabase } from './database.js';
import { activeHouseholdKey, LocalProfileMissing } from './profiles.js';

export class LocalHouseholdMissing extends Data.TaggedError('LocalHouseholdMissing')<{
	readonly householdId: string;
}> {}

export class DetachedSnapshotRequired extends Data.TaggedError('DetachedSnapshotRequired')<{
	readonly householdId: string;
	readonly profileId: string;
}> {}

const nowUtc = (): `${string}Z` => new Date().toISOString() as `${string}Z`;

const actorContext = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	permission: HouseholdPermission
): Promise<{
	profile: Profile;
	membership: Membership;
	authSlotId: string;
	originDeviceId: string;
}> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	const membershipRecord = await database.memberships
		.where('[householdId+workosUserId]')
		.equals([householdId, profile.workosUserId])
		.first();
	const membership = membershipRecord
		? Schema.decodeUnknownSync(MembershipSchema)(membershipRecord)
		: undefined;
	requireCachedPermission(membership, householdId, permission);
	const slot = await database.authSlots.where('profileId').equals(profileId).first();
	const device = await database.meta.get('deviceId');
	return {
		profile,
		membership: membership as Membership,
		authSlotId: slot?.authSlotId ?? `signed-out:${profileId}`,
		originDeviceId: Schema.decodeUnknownSync(DomainIdSchema)(device?.value)
	};
};

export interface ProfileHouseholdView {
	readonly household: Household;
	readonly membership: Membership;
	readonly detached: boolean;
}

export const listHouseholdsForProfile = async (
	database: MaalDatabase,
	profileId: string
): Promise<readonly ProfileHouseholdView[]> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	const memberships = await database.memberships
		.where('workosUserId')
		.equals(profile.workosUserId)
		.filter(({ status }) => status !== 'revoked')
		.toArray();
	const views: ProfileHouseholdView[] = [];
	for (const candidate of memberships) {
		const household = await database.households.get(candidate.householdId);
		if (!household || household.deletionState === 'purged') continue;
		views.push({
			household: Schema.decodeUnknownSync(HouseholdSchema)(household),
			membership: Schema.decodeUnknownSync(MembershipSchema)(candidate),
			detached: candidate.status === 'detached'
		});
	}
	return views.sort((left, right) => left.household.name.localeCompare(right.household.name));
};

export const setActiveHousehold = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string
): Promise<void> => {
	const views = await listHouseholdsForProfile(database, profileId);
	if (!views.some(({ household }) => household.householdId === householdId)) {
		throw new LocalHouseholdMissing({ householdId });
	}
	await database.uiState.put({ key: activeHouseholdKey(profileId), value: householdId });
};

export const updateHouseholdSettings = async (
	database: MaalDatabase,
	input: {
		profileId: string;
		householdId: string;
		patch: HouseholdSettingsPatch;
		occurredAt?: `${string}Z`;
	}
): Promise<Household> => {
	const patch = Schema.decodeUnknownSync(HouseholdSettingsPatchSchema)(input.patch);
	const household = await database.households.get(input.householdId);
	if (!household) throw new LocalHouseholdMissing({ householdId: input.householdId });
	const actor = await actorContext(
		database,
		input.profileId,
		input.householdId,
		'households:write'
	);
	const result = await executeLocalCommand(database, {
		authSlotId: actor.authSlotId,
		scopeKind: 'household',
		scopeId: input.householdId,
		entityKind: 'household',
		aggregateId: input.householdId,
		conflictGroup: 'settings',
		operation: 'upsert',
		originDeviceId: actor.originDeviceId,
		occurredAt: input.occurredAt,
		payload: patch,
		payloadSchema: HouseholdSettingsPatchSchema,
		writes: [
			{
				store: 'households',
				aggregateId: input.householdId,
				identity: { householdId: input.householdId },
				conflictGroups: ['settings'],
				schema: HouseholdSchema,
				update: (current) => ({ ...(current as Household), ...patch })
			}
		]
	});
	return result.aggregates[0] as Household;
};

const ApplianceCommandPayloadSchema = Schema.Struct({
	householdId: Schema.String,
	appliances: Schema.Array(HouseholdAppliancePatchSchema)
});

export const updateHouseholdAppliances = async (
	database: MaalDatabase,
	input: {
		profileId: string;
		householdId: string;
		appliances: readonly HouseholdAppliancePatch[];
		occurredAt?: `${string}Z`;
	}
): Promise<readonly unknown[]> => {
	const appliances = Schema.decodeUnknownSync(Schema.Array(HouseholdAppliancePatchSchema))(
		input.appliances
	);
	if (!(await database.households.get(input.householdId))) {
		throw new LocalHouseholdMissing({ householdId: input.householdId });
	}
	const actor = await actorContext(
		database,
		input.profileId,
		input.householdId,
		'households:write'
	);
	if (appliances.length === 0) return [];
	const mutationIds = appliances.map(() => uuidv7());
	return (
		await executeLocalCommand(database, {
			authSlotId: actor.authSlotId,
			scopeKind: 'household',
			scopeId: input.householdId,
			entityKind: 'householdAppliance',
			aggregateId: appliances[0]!.id,
			conflictGroup: 'row',
			operation: 'upsert',
			originDeviceId: actor.originDeviceId,
			occurredAt: input.occurredAt,
			mutationId: mutationIds[0],
			additionalMutations: appliances.slice(1).map((appliance, index) => ({
				mutationId: mutationIds[index + 1]!,
				entityKind: 'householdAppliance',
				aggregateId: appliance.id,
				conflictGroup: 'row',
				operation: 'upsert' as const
			})),
			payload: { householdId: input.householdId, appliances },
			payloadSchema: ApplianceCommandPayloadSchema,
			writes: appliances.map((appliance, index) => ({
				store: 'householdAppliances' as const,
				aggregateId: appliance.id,
				mutationId: mutationIds[index],
				identity: { id: appliance.id, householdId: input.householdId },
				conflictGroups: ['row'],
				schema: HouseholdApplianceSchema,
				update: (current: unknown) => ({
					...(current as Record<string, unknown> | undefined),
					...appliance,
					householdId: input.householdId,
					deletedAt: null
				})
			}))
		})
	).aggregates;
};

export const detachHouseholdSnapshot = async (
	database: MaalDatabase,
	input: {
		profileId: string;
		householdId: string;
		denialCode: string;
		detachedAt?: `${string}Z`;
	}
): Promise<void> => {
	const profile = await database.profiles.get(input.profileId);
	if (!profile) throw new LocalProfileMissing({ profileId: input.profileId });
	const membership = await database.memberships
		.where('[householdId+workosUserId]')
		.equals([input.householdId, profile.workosUserId])
		.first();
	if (!membership) throw new LocalHouseholdMissing({ householdId: input.householdId });
	const slot = await database.authSlots.where('profileId').equals(input.profileId).first();
	const detachedAt = Schema.decodeUnknownSync(UtcInstantSchema)(input.detachedAt ?? nowUtc());

	await database.transaction(
		'rw',
		database.memberships,
		database.outbox,
		database.syncScopes,
		async () => {
			await database.memberships.update(membership.membershipId, {
				status: 'detached',
				detachedAt,
				denialCode: input.denialCode,
				updatedAt: detachedAt
			});
			await database.outbox
				.filter(
					(mutation) =>
						mutation.scopeKind === 'household' &&
						mutation.scopeId === input.householdId &&
						(!slot || mutation.authSlotId === slot.authSlotId) &&
						mutation.status !== 'acknowledged'
				)
				.modify({ status: 'quarantined' });
			await database.syncScopes
				.filter((scope) => scope.scopeKind === 'household' && scope.scopeId === input.householdId)
				.modify({
					state: 'blocked',
					leaseOwner: null,
					leaseExpiresAt: null,
					lastErrorCode: input.denialCode
				});
		}
	);
};

const collectIds = (value: unknown, ids: Set<string>): void => {
	if (Array.isArray(value)) {
		for (const item of value) collectIds(item, ids);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	const record = value as Record<string, unknown>;
	if (typeof record.id === 'string') ids.add(record.id);
	for (const nested of Object.values(record)) collectIds(nested, ids);
};

const remapValue = (value: unknown, idMap: ReadonlyMap<string, string>): unknown => {
	if (typeof value === 'string') return idMap.get(value) ?? value;
	if (Array.isArray(value)) return value.map((item) => remapValue(item, idMap));
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, nested]) => [key, remapValue(nested, idMap)])
	);
};

export interface ForkDetachedSnapshotResult {
	readonly householdId: string;
	readonly mealCount: number;
	readonly checkInCount: number;
}

export const forkDetachedHouseholdSnapshot = async (
	database: MaalDatabase,
	input: {
		profileId: string;
		householdId: string;
		name?: string;
		occurredAt?: `${string}Z`;
	}
): Promise<ForkDetachedSnapshotResult> => {
	const profile = await database.profiles.get(input.profileId);
	if (!profile) throw new LocalProfileMissing({ profileId: input.profileId });
	const membership = await database.memberships
		.where('[householdId+workosUserId]')
		.equals([input.householdId, profile.workosUserId])
		.first();
	if (membership?.status !== 'detached') {
		throw new DetachedSnapshotRequired({
			householdId: input.householdId,
			profileId: input.profileId
		});
	}
	const household = await database.households.get(input.householdId);
	if (!household) throw new LocalHouseholdMissing({ householdId: input.householdId });
	const occurredAt = Schema.decodeUnknownSync(UtcInstantSchema)(input.occurredAt ?? nowUtc());
	const newHouseholdId = uuidv7();
	const meals = await database.meals.where('householdId').equals(input.householdId).toArray();
	const mealIds = new Set(meals.map(({ id }) => id));
	const checkIns = await database.mealCheckIns
		.filter((checkIn) => typeof checkIn.mealId === 'string' && mealIds.has(checkIn.mealId))
		.toArray();
	const appliances = await database.householdAppliances
		.where('householdId')
		.equals(input.householdId)
		.toArray();
	const householdStoreNames = [
		'foodHouseholdAliases',
		'foodHouseholdEntries',
		'unitHouseholdAliases',
		'unitHouseholdEntries',
		'householdFoodDisplayPreferences',
		'householdUnitDisplayPreferences'
	] as const;
	const scopedRows = new Map<(typeof householdStoreNames)[number], Record<string, unknown>[]>();
	for (const tableName of householdStoreNames) {
		scopedRows.set(
			tableName,
			(await database
				.table(tableName)
				.where('householdId')
				.equals(input.householdId)
				.toArray()) as Record<string, unknown>[]
		);
	}

	const ids = new Set<string>();
	for (const record of [...meals, ...checkIns, ...appliances, ...scopedRows.values()].flat()) {
		collectIds(record, ids);
	}
	const idMap = new Map<string, string>([[input.householdId, newHouseholdId]]);
	for (const id of ids) idMap.set(id, uuidv7());
	const clone = <T>(value: T): T => remapValue(value, idMap) as T;
	const forkedMeals = meals.map((meal) => ({ ...clone(meal), householdId: newHouseholdId }));
	const forkedCheckIns = checkIns.map((checkIn) => clone(checkIn));
	const forkedAppliances = appliances.map((appliance) => ({
		...clone(appliance),
		householdId: newHouseholdId
	}));

	await database.transaction('rw', database.tables, async () => {
		await database.households.add({
			...household,
			householdId: newHouseholdId,
			name: input.name?.trim() || `${household.name} (local copy)`,
			createdByUserId: profile.workosUserId,
			deletionState: 'active',
			localOnly: true,
			revision: 1,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			deletedAt: null,
			conflictClocks: {}
		});
		await database.memberships.add({
			membershipId: uuidv7(),
			householdId: newHouseholdId,
			workosUserId: profile.workosUserId,
			roleSlug: 'admin',
			permissions: [
				'households:write',
				'recipes:read',
				'recipes:write',
				'meals:read',
				'meals:write'
			],
			status: 'active',
			directoryManaged: false,
			workosCreatedAt: occurredAt,
			lastVerifiedAt: occurredAt,
			updatedAt: occurredAt,
			detachedAt: null,
			denialCode: null,
			source: 'localFork'
		});
		if (forkedMeals.length) await database.meals.bulkAdd(forkedMeals);
		if (forkedCheckIns.length) await database.mealCheckIns.bulkAdd(forkedCheckIns);
		if (forkedAppliances.length) await database.householdAppliances.bulkAdd(forkedAppliances);
		for (const tableName of householdStoreNames) {
			const rows = (scopedRows.get(tableName) ?? []).map((row) => ({
				...clone(row),
				householdId: newHouseholdId
			}));
			if (rows.length) await database.table(tableName).bulkAdd(rows);
		}
		await database.uiState.put({ key: activeHouseholdKey(input.profileId), value: newHouseholdId });
	});

	return {
		householdId: newHouseholdId,
		mealCount: forkedMeals.length,
		checkInCount: forkedCheckIns.length
	};
};

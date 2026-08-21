import { Schema } from 'effect';

import { executeLocalCommand } from '$lib/client/local/commands.js';
import type { AggregateStoreName } from '$lib/client/local/commands.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalDecodeError, TaxonomyInvariantError } from '$lib/domain/contracts/errors.js';
import { DomainIdSchema, type ScopeKind } from '$lib/domain/contracts/primitives.js';
import {
	FoodHouseholdAliasSchema,
	FoodHouseholdEntrySchema,
	FoodUserAliasSchema,
	FoodUserEntrySchema,
	HouseholdFoodDisplayPreferenceSchema,
	HouseholdUnitDisplayPreferenceSchema,
	TaxonomyEditableSchemas,
	UnitHouseholdAliasSchema,
	UnitHouseholdEntrySchema,
	UnitUserAliasSchema,
	UnitUserEntrySchema,
	UserFoodDisplayPreferenceSchema,
	UserFoodPreferenceSchema,
	UserUnitDisplayPreferenceSchema,
	type FoodHouseholdAlias,
	type FoodHouseholdEntry,
	type FoodUserAlias,
	type FoodUserEntry,
	type HouseholdFoodDisplayPreference,
	type HouseholdUnitDisplayPreference,
	type TaxonomyEditableEntityKind,
	type UnitHouseholdAlias,
	type UnitHouseholdEntry,
	type UnitUserAlias,
	type UnitUserEntry,
	type UserFoodDisplayPreference,
	type UserFoodPreference,
	type UserUnitDisplayPreference
} from '$lib/domain/taxonomy/schema.js';

type MutableKeys =
	'schemaVersion' | 'revision' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'conflictClocks';

export type TaxonomyDraft<A> = Omit<A, MutableKeys>;

export interface TaxonomyEditableRecordMap {
	foodUserAlias: FoodUserAlias;
	foodHouseholdAlias: FoodHouseholdAlias;
	foodUserEntry: FoodUserEntry;
	foodHouseholdEntry: FoodHouseholdEntry;
	unitUserAlias: UnitUserAlias;
	unitHouseholdAlias: UnitHouseholdAlias;
	unitUserEntry: UnitUserEntry;
	unitHouseholdEntry: UnitHouseholdEntry;
	userFoodPreference: UserFoodPreference;
	userFoodDisplayPreference: UserFoodDisplayPreference;
	householdFoodDisplayPreference: HouseholdFoodDisplayPreference;
	userUnitDisplayPreference: UserUnitDisplayPreference;
	householdUnitDisplayPreference: HouseholdUnitDisplayPreference;
}

export interface TaxonomyCommandContext {
	database: MaalDatabase;
	authSlotId: string;
	originDeviceId: string;
	occurredAt?: string;
	mutationId?: string;
}

const mutableKeys = [
	'schemaVersion',
	'revision',
	'createdAt',
	'updatedAt',
	'deletedAt',
	'conflictClocks'
] as const;

const omitFields = Schema.omit as unknown as (
	...keys: readonly string[]
) => (schema: Schema.Schema.AnyNoContext) => Schema.Schema.AnyNoContext;

const draftSchema = (schema: Schema.Schema.AnyNoContext): Schema.Schema.AnyNoContext =>
	omitFields(...mutableKeys)(schema);

const descriptors = {
	foodUserAlias: {
		store: 'foodUserAliases',
		ownerKey: 'workosUserId',
		scopeKind: 'user',
		schema: FoodUserAliasSchema,
		payloadSchema: draftSchema(FoodUserAliasSchema)
	},
	foodHouseholdAlias: {
		store: 'foodHouseholdAliases',
		ownerKey: 'householdId',
		scopeKind: 'household',
		schema: FoodHouseholdAliasSchema,
		payloadSchema: draftSchema(FoodHouseholdAliasSchema)
	},
	foodUserEntry: {
		store: 'foodUserEntries',
		ownerKey: 'workosUserId',
		scopeKind: 'user',
		schema: FoodUserEntrySchema,
		payloadSchema: draftSchema(FoodUserEntrySchema)
	},
	foodHouseholdEntry: {
		store: 'foodHouseholdEntries',
		ownerKey: 'householdId',
		scopeKind: 'household',
		schema: FoodHouseholdEntrySchema,
		payloadSchema: draftSchema(FoodHouseholdEntrySchema)
	},
	unitUserAlias: {
		store: 'unitUserAliases',
		ownerKey: 'workosUserId',
		scopeKind: 'user',
		schema: UnitUserAliasSchema,
		payloadSchema: draftSchema(UnitUserAliasSchema)
	},
	unitHouseholdAlias: {
		store: 'unitHouseholdAliases',
		ownerKey: 'householdId',
		scopeKind: 'household',
		schema: UnitHouseholdAliasSchema,
		payloadSchema: draftSchema(UnitHouseholdAliasSchema)
	},
	unitUserEntry: {
		store: 'unitUserEntries',
		ownerKey: 'workosUserId',
		scopeKind: 'user',
		schema: UnitUserEntrySchema,
		payloadSchema: draftSchema(UnitUserEntrySchema)
	},
	unitHouseholdEntry: {
		store: 'unitHouseholdEntries',
		ownerKey: 'householdId',
		scopeKind: 'household',
		schema: UnitHouseholdEntrySchema,
		payloadSchema: draftSchema(UnitHouseholdEntrySchema)
	},
	userFoodPreference: {
		store: 'userFoodPreferences',
		ownerKey: 'workosUserId',
		scopeKind: 'user',
		schema: UserFoodPreferenceSchema,
		payloadSchema: draftSchema(UserFoodPreferenceSchema)
	},
	userFoodDisplayPreference: {
		store: 'userFoodDisplayPreferences',
		ownerKey: 'workosUserId',
		scopeKind: 'user',
		schema: UserFoodDisplayPreferenceSchema,
		payloadSchema: draftSchema(UserFoodDisplayPreferenceSchema)
	},
	householdFoodDisplayPreference: {
		store: 'householdFoodDisplayPreferences',
		ownerKey: 'householdId',
		scopeKind: 'household',
		schema: HouseholdFoodDisplayPreferenceSchema,
		payloadSchema: draftSchema(HouseholdFoodDisplayPreferenceSchema)
	},
	userUnitDisplayPreference: {
		store: 'userUnitDisplayPreferences',
		ownerKey: 'workosUserId',
		scopeKind: 'user',
		schema: UserUnitDisplayPreferenceSchema,
		payloadSchema: draftSchema(UserUnitDisplayPreferenceSchema)
	},
	householdUnitDisplayPreference: {
		store: 'householdUnitDisplayPreferences',
		ownerKey: 'householdId',
		scopeKind: 'household',
		schema: HouseholdUnitDisplayPreferenceSchema,
		payloadSchema: draftSchema(HouseholdUnitDisplayPreferenceSchema)
	}
} as const satisfies Record<
	TaxonomyEditableEntityKind,
	{
		store: AggregateStoreName;
		ownerKey: 'workosUserId' | 'householdId';
		scopeKind: ScopeKind;
		schema: Schema.Schema.AnyNoContext;
		payloadSchema: Schema.Schema.AnyNoContext;
	}
>;

const invariant = (message: string): never => {
	throw new TaxonomyInvariantError({ operation: 'validate taxonomy command', message });
};

const decodeLocal = <A>(schema: Schema.Schema<A>, input: unknown, operation: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(input);
	} catch {
		throw new LocalDecodeError({ operation, message: 'Taxonomy data did not match its contract.' });
	}
};

const encodeLocal = <A>(schema: Schema.Schema<A>, value: A, operation: string): unknown => {
	try {
		return Schema.encodeSync(schema)(value);
	} catch {
		throw new LocalDecodeError({ operation, message: 'Taxonomy data could not be encoded.' });
	}
};

const requireFood = async (database: MaalDatabase, foodId: string): Promise<void> => {
	if (!(await database.foods.get(foodId))) invariant('The referenced global food does not exist.');
};

const requireUnitPair = async (
	database: MaalDatabase,
	unitId: string | null,
	baseUnitId: string | null
): Promise<void> => {
	if (unitId === null && baseUnitId === null) return;
	if (unitId === null || baseUnitId === null)
		invariant('A unit reference must include its base family.');
	const unit = await database.units.get(unitId as string);
	if (!unit || unit.baseUnitId !== baseUnitId) {
		invariant('The referenced unit does not belong to the requested base family.');
	}
};

const validateAliasReference = async (
	database: MaalDatabase,
	kind: 'food' | 'unit',
	scope: string | null,
	id: string | null,
	targetId: string
): Promise<void> => {
	if (scope === null || id === null) return;
	const table =
		kind === 'food'
			? scope === 'global'
				? database.foodAliases
				: scope === 'household'
					? database.foodHouseholdAliases
					: database.foodUserAliases
			: scope === 'global'
				? database.unitAliases
				: scope === 'household'
					? database.unitHouseholdAliases
					: database.unitUserAliases;
	const alias = (await table.get(id)) as
		{ foodId?: string; baseUnitId?: string; deletedAt?: string | null } | undefined;
	if (
		!alias ||
		(alias.deletedAt !== null && alias.deletedAt !== undefined) ||
		(kind === 'food' ? alias.foodId !== targetId : alias.baseUnitId !== targetId)
	) {
		invariant('The preferred alias does not match the selected taxonomy row.');
	}
};

const validateDraft = async <K extends TaxonomyEditableEntityKind>(
	database: MaalDatabase,
	kind: K,
	draft: TaxonomyDraft<TaxonomyEditableRecordMap[K]>
): Promise<void> => {
	const row = draft as Record<string, unknown>;
	if ('foodId' in row) await requireFood(database, row.foodId as string);
	if ('defaultMeasureUnitId' in row) {
		await requireUnitPair(
			database,
			row.defaultMeasureUnitId as string | null,
			row.defaultMeasureBaseUnitId as string | null
		);
	}
	if ('preferredMeasureUnitId' in row) {
		await requireUnitPair(
			database,
			row.preferredMeasureUnitId as string | null,
			row.preferredMeasureBaseUnitId as string | null
		);
	}
	if (kind.startsWith('unit') && 'unitId' in row) {
		await requireUnitPair(database, row.unitId as string, row.baseUnitId as string);
	}
	if (
		(kind === 'unitUserEntry' || kind === 'unitHouseholdEntry') &&
		!(await database.units.get(row.baseUnitId as string))
	) {
		invariant('A custom unit must reference a global base unit.');
	}
	if (kind === 'userUnitDisplayPreference' || kind === 'householdUnitDisplayPreference') {
		await requireUnitPair(database, row.preferredUnitId as string, row.baseUnitId as string);
		await validateAliasReference(
			database,
			'unit',
			row.preferredUnitAliasScope as string | null,
			row.preferredUnitAliasId as string | null,
			row.baseUnitId as string
		);
	}
	if (kind === 'userFoodDisplayPreference' || kind === 'householdFoodDisplayPreference') {
		await validateAliasReference(
			database,
			'food',
			row.preferredFoodAliasScope as string | null,
			row.preferredFoodAliasId as string | null,
			row.foodId as string
		);
	}
};

export const upsertTaxonomyRecord = async <K extends TaxonomyEditableEntityKind>(
	context: TaxonomyCommandContext,
	kind: K,
	draft: TaxonomyDraft<TaxonomyEditableRecordMap[K]>
): Promise<TaxonomyEditableRecordMap[K]> => {
	const descriptor = descriptors[kind];
	const decodedDraft = decodeLocal(
		descriptor.payloadSchema,
		draft,
		`decode ${kind} command`
	) as TaxonomyDraft<TaxonomyEditableRecordMap[K]>;
	await validateDraft(context.database, kind, decodedDraft);
	const row = decodedDraft as Record<string, unknown>;
	const scopeId = row[descriptor.ownerKey];
	if (typeof scopeId !== 'string') invariant('The taxonomy row is missing its owner.');

	const result = await executeLocalCommand(context.database, {
		authSlotId: context.authSlotId,
		scopeKind: descriptor.scopeKind,
		scopeId: scopeId as string,
		entityKind: kind,
		aggregateId: row.id as string,
		conflictGroup: 'row',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt: context.occurredAt,
		mutationId: context.mutationId,
		payload: decodedDraft,
		payloadSchema: descriptor.payloadSchema,
		writes: [
			{
				store: descriptor.store,
				aggregateId: row.id as string,
				conflictGroups: ['row'],
				schema: descriptor.schema,
				update: () => ({ ...decodedDraft, deletedAt: null })
			}
		]
	});
	return result.aggregates[0] as TaxonomyEditableRecordMap[K];
};

export const deleteTaxonomyRecord = async <K extends TaxonomyEditableEntityKind>(
	context: TaxonomyCommandContext,
	kind: K,
	recordId: string
): Promise<TaxonomyEditableRecordMap[K]> => {
	const descriptor = descriptors[kind];
	const id = decodeLocal(DomainIdSchema, recordId, `decode ${kind} ID`);
	const table = context.database.table(descriptor.store);
	const current = (await table.get(id)) as TaxonomyEditableRecordMap[K] | undefined;
	if (!current) invariant('The taxonomy row to delete does not exist.');
	const row = current as unknown as Record<string, unknown>;
	const scopeId = row[descriptor.ownerKey];
	if (typeof scopeId !== 'string') invariant('The taxonomy row is missing its owner.');
	const occurredAt = context.occurredAt ?? new Date().toISOString();
	const result = await executeLocalCommand(context.database, {
		authSlotId: context.authSlotId,
		scopeKind: descriptor.scopeKind,
		scopeId: scopeId as string,
		entityKind: kind,
		aggregateId: id,
		conflictGroup: 'row',
		operation: 'delete',
		originDeviceId: context.originDeviceId,
		occurredAt,
		mutationId: context.mutationId,
		payload: { id },
		payloadSchema: Schema.Struct({ id: DomainIdSchema }),
		writes: [
			{
				store: descriptor.store,
				aggregateId: id,
				conflictGroups: ['row'],
				schema: descriptor.schema,
				update: () => ({ ...current, deletedAt: occurredAt })
			}
		]
	});
	return result.aggregates[0] as TaxonomyEditableRecordMap[K];
};

export const decodeTaxonomyRecord = <K extends TaxonomyEditableEntityKind>(
	kind: K,
	input: unknown
): TaxonomyEditableRecordMap[K] =>
	decodeLocal(
		TaxonomyEditableSchemas[kind] as unknown as Schema.Schema<TaxonomyEditableRecordMap[K]>,
		input,
		`decode ${kind} record`
	);

export const encodeTaxonomyRecord = <K extends TaxonomyEditableEntityKind>(
	kind: K,
	record: TaxonomyEditableRecordMap[K]
): unknown =>
	encodeLocal(
		TaxonomyEditableSchemas[kind] as unknown as Schema.Schema<TaxonomyEditableRecordMap[K]>,
		record,
		`encode ${kind} record`
	);

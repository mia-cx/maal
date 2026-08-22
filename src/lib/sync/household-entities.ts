import { Schema } from 'effect';

import type { AggregateStoreName } from '$lib/client/local/commands.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import { HouseholdApplianceSchema, HouseholdSchema } from '$lib/domain/household/contracts.js';
import {
	MEAL_CONFLICT_GROUPS,
	MealCheckInSchema,
	StoredMealSchema
} from '$lib/domain/meals/schema.js';
import {
	FoodHouseholdAliasSchema,
	FoodHouseholdEntrySchema,
	HouseholdFoodDisplayPreferenceSchema,
	HouseholdUnitDisplayPreferenceSchema,
	UnitHouseholdAliasSchema,
	UnitHouseholdEntrySchema
} from '$lib/domain/taxonomy/schema.js';

import type { HouseholdSyncEntityKind } from './household-contracts.js';

export interface HouseholdSyncEntityDescriptor {
	readonly store: AggregateStoreName;
	readonly schema: Schema.Schema.AnyNoContext;
	readonly conflictGroups: readonly string[];
}

export const HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS = {
	household: { store: 'households', schema: HouseholdSchema, conflictGroups: ['settings'] },
	meal: { store: 'meals', schema: StoredMealSchema, conflictGroups: MEAL_CONFLICT_GROUPS },
	meal_check_in: { store: 'mealCheckIns', schema: MealCheckInSchema, conflictGroups: ['response'] },
	householdAppliance: {
		store: 'householdAppliances',
		schema: HouseholdApplianceSchema,
		conflictGroups: ['row']
	},
	foodHouseholdAlias: {
		store: 'foodHouseholdAliases',
		schema: FoodHouseholdAliasSchema,
		conflictGroups: ['row']
	},
	foodHouseholdEntry: {
		store: 'foodHouseholdEntries',
		schema: FoodHouseholdEntrySchema,
		conflictGroups: ['row']
	},
	unitHouseholdAlias: {
		store: 'unitHouseholdAliases',
		schema: UnitHouseholdAliasSchema,
		conflictGroups: ['row']
	},
	unitHouseholdEntry: {
		store: 'unitHouseholdEntries',
		schema: UnitHouseholdEntrySchema,
		conflictGroups: ['row']
	},
	householdFoodDisplayPreference: {
		store: 'householdFoodDisplayPreferences',
		schema: HouseholdFoodDisplayPreferenceSchema,
		conflictGroups: ['row']
	},
	householdUnitDisplayPreference: {
		store: 'householdUnitDisplayPreferences',
		schema: HouseholdUnitDisplayPreferenceSchema,
		conflictGroups: ['row']
	}
} as const satisfies Record<HouseholdSyncEntityKind, HouseholdSyncEntityDescriptor>;

export interface DecodedHouseholdSyncAggregate {
	readonly entityKind: HouseholdSyncEntityKind;
	readonly entityId: string;
	readonly store: AggregateStoreName;
	readonly aggregate: Record<string, unknown> & {
		readonly id: string;
		readonly revision: number;
		readonly updatedAt: string;
		readonly deletedAt: string | null;
	};
}

export const decodeHouseholdSyncAggregate = (
	entityKind: HouseholdSyncEntityKind,
	entityId: string,
	householdId: string,
	input: unknown
): DecodedHouseholdSyncAggregate => {
	const descriptor = HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[entityKind];
	try {
		const schema: Schema.Schema.AnyNoContext = descriptor.schema;
		const aggregate = Schema.decodeUnknownSync(schema)(input) as Record<string, unknown> & {
			id: string;
			revision: number;
			updatedAt: string;
			deletedAt: string | null;
		};
		const aggregateId = entityKind === 'household' ? aggregate.householdId : aggregate.id;
		if (aggregateId !== entityId) throw new Error('entity mismatch');
		if (entityKind !== 'meal_check_in' && aggregate.householdId !== householdId) {
			throw new Error('household mismatch');
		}
		return { entityKind, entityId, store: descriptor.store, aggregate };
	} catch {
		throw new LocalDecodeError({
			operation: `decode synchronized ${entityKind}`,
			message: 'Remote household data did not match its complete aggregate contract.'
		});
	}
};

export const isAllowedHouseholdConflictGroup = (
	entityKind: HouseholdSyncEntityKind,
	group: string
): boolean => HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[entityKind].conflictGroups.includes(group);

export const assertHouseholdMutationActor = (
	entityKind: HouseholdSyncEntityKind,
	actorUserId: string,
	aggregate: Record<string, unknown>
): void => {
	if (entityKind === 'meal_check_in' && aggregate.reporterUserId !== actorUserId) {
		throw new LocalDecodeError({
			operation: 'authorize synchronized check-in',
			message: 'A check-in can only be written by its reporter.'
		});
	}
};

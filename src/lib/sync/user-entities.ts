import { Schema } from 'effect';

import type { AggregateStoreName } from '$lib/client/local/commands.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import { StoredRecipeSchema } from '$lib/domain/recipes/schema.js';
import { RECIPE_CONFLICT_GROUPS } from '$lib/domain/recipes/schema.js';
import {
	FoodUserAliasSchema,
	FoodUserEntrySchema,
	UnitUserAliasSchema,
	UnitUserEntrySchema,
	UserFoodDisplayPreferenceSchema,
	UserFoodPreferenceSchema,
	UserUnitDisplayPreferenceSchema
} from '$lib/domain/taxonomy/schema.js';

import type { UserSyncEntityKind } from './contracts.js';

export interface UserSyncEntityDescriptor {
	readonly store: AggregateStoreName;
	readonly schema: Schema.Schema.AnyNoContext;
	readonly conflictGroups: readonly string[];
}

export const USER_SYNC_ENTITY_DESCRIPTORS = {
	recipe: { store: 'recipes', schema: StoredRecipeSchema, conflictGroups: RECIPE_CONFLICT_GROUPS },
	foodUserAlias: { store: 'foodUserAliases', schema: FoodUserAliasSchema, conflictGroups: ['row'] },
	foodUserEntry: { store: 'foodUserEntries', schema: FoodUserEntrySchema, conflictGroups: ['row'] },
	unitUserAlias: { store: 'unitUserAliases', schema: UnitUserAliasSchema, conflictGroups: ['row'] },
	unitUserEntry: { store: 'unitUserEntries', schema: UnitUserEntrySchema, conflictGroups: ['row'] },
	userFoodPreference: {
		store: 'userFoodPreferences',
		schema: UserFoodPreferenceSchema,
		conflictGroups: ['row']
	},
	userFoodDisplayPreference: {
		store: 'userFoodDisplayPreferences',
		schema: UserFoodDisplayPreferenceSchema,
		conflictGroups: ['row']
	},
	userUnitDisplayPreference: {
		store: 'userUnitDisplayPreferences',
		schema: UserUnitDisplayPreferenceSchema,
		conflictGroups: ['row']
	}
} as const satisfies Record<UserSyncEntityKind, UserSyncEntityDescriptor>;

export interface DecodedUserSyncAggregate {
	readonly entityKind: UserSyncEntityKind;
	readonly entityId: string;
	readonly store: AggregateStoreName;
	readonly aggregate: Record<string, unknown> & {
		readonly id: string;
		readonly revision: number;
		readonly updatedAt: string;
		readonly deletedAt: string | null;
	};
}

export const decodeUserSyncAggregate = (
	entityKind: UserSyncEntityKind,
	entityId: string,
	ownerUserId: string,
	input: unknown
): DecodedUserSyncAggregate => {
	const descriptor = USER_SYNC_ENTITY_DESCRIPTORS[entityKind];
	try {
		const schema: Schema.Schema.AnyNoContext = descriptor.schema;
		const aggregate = Schema.decodeUnknownSync(schema)(input) as Record<string, unknown> & {
			id: string;
			revision: number;
			updatedAt: string;
			deletedAt: string | null;
		};
		const aggregateOwner = aggregate.ownerUserId ?? aggregate.workosUserId;
		if (aggregate.id !== entityId || aggregateOwner !== ownerUserId)
			throw new Error('owner mismatch');
		return { entityKind, entityId, store: descriptor.store, aggregate };
	} catch {
		throw new LocalDecodeError({
			operation: `decode synchronized ${entityKind}`,
			message: 'Remote user data did not match its complete aggregate contract.'
		});
	}
};

export const isAllowedUserConflictGroup = (
	entityKind: UserSyncEntityKind,
	group: string
): boolean => USER_SYNC_ENTITY_DESCRIPTORS[entityKind].conflictGroups.includes(group);

export const readConflictGroupsForMutation = (
	aggregate: Record<string, unknown>,
	mutationId: string,
	fallback: string
): readonly string[] => {
	const clocks = aggregate.conflictClocks;
	if (typeof clocks !== 'object' || clocks === null || Array.isArray(clocks)) return [fallback];
	const groups = Object.entries(clocks)
		.filter(([, value]) => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
			return (value as { mutationId?: unknown }).mutationId === mutationId;
		})
		.map(([group]) => group);
	return groups.length > 0 ? groups : [fallback];
};

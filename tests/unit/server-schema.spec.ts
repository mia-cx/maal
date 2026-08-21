import { Effect, Either } from 'effect';
import { getTableName, isTable } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import {
	decodeMembershipPermissions,
	decodeMcpScopes,
	decodeSyncPayload,
	encodeMembershipPermissions,
	encodeSyncPayload,
	toD1WriteError
} from '$lib/server/db/contracts.js';
import * as schema from '$lib/server/db/schema/index.js';

const expectedTableNames = [
	'billing_audit_events',
	'billing_subscriptions',
	'billing_trial_claims',
	'food_aliases',
	'food_household_aliases',
	'food_household_entries',
	'food_user_aliases',
	'food_user_entries',
	'foods',
	'household_appliances',
	'household_deletion_requests',
	'household_food_display_overrides',
	'household_invites',
	'household_membership_mutation_locks',
	'household_memberships',
	'household_unit_display_overrides',
	'households',
	'mcp_key_households',
	'mcp_keys',
	'meal_appliance_requirements',
	'meal_check_ins',
	'meal_classifications',
	'meal_ingredients',
	'meal_instruction_events',
	'meal_instructions',
	'meal_media',
	'meal_nutrition_facts',
	'meals',
	'recipe_appliance_requirements',
	'recipe_classifications',
	'recipe_ingredients',
	'recipe_instruction_events',
	'recipe_instructions',
	'recipe_media',
	'recipe_nutrition_facts',
	'recipes',
	'stripe_events',
	'sync_changes',
	'sync_devices',
	'sync_entity_versions',
	'sync_mutation_receipts',
	'sync_scope_state',
	'sync_tombstones',
	'unit_aliases',
	'unit_household_aliases',
	'unit_household_entries',
	'unit_user_aliases',
	'unit_user_entries',
	'units',
	'user_food_display_overrides',
	'user_food_preferences',
	'user_unit_display_overrides',
	'users'
].sort();

describe('normalized D1 schema', () => {
	it('exports every v1 table family', () => {
		const actual = Object.values(schema)
			.flatMap((value) => (isTable(value) ? [getTableName(value)] : []))
			.sort();
		expect(actual).toEqual(expectedTableNames);
	});

	it('keeps conflict clocks in the normalized sync-version table', () => {
		const columns = getTableConfig(schema.syncEntityVersions).columns.map((column) => column.name);
		expect(columns).toEqual(
			expect.arrayContaining([
				'revision',
				'last_sequence',
				'winning_occurred_at',
				'winning_origin_device_id',
				'winning_mutation_id'
			])
		);
	});

	it('gives every editable aggregate a revision and tombstone', () => {
		const editableTables = [
			schema.users,
			schema.households,
			schema.householdAppliances,
			schema.recipes,
			schema.meals,
			schema.mealCheckIns,
			schema.foodUserAliases,
			schema.foodHouseholdAliases,
			schema.foodUserEntries,
			schema.foodHouseholdEntries,
			schema.unitUserAliases,
			schema.unitHouseholdAliases,
			schema.unitUserEntries,
			schema.unitHouseholdEntries,
			schema.userFoodPreferences,
			schema.userFoodDisplayPreferences,
			schema.householdFoodDisplayPreferences,
			schema.userUnitDisplayPreferences,
			schema.householdUnitDisplayPreferences
		];

		for (const table of editableTables) {
			const columns = new Set(getTableConfig(table).columns.map((column) => column.name));
			for (const column of [
				'schema_version',
				'revision',
				'created_at',
				'updated_at',
				'deleted_at'
			]) {
				expect(columns.has(column), `${getTableName(table)}.${column}`).toBe(true);
			}
		}
	});
});

describe('D1 JSON row contracts', () => {
	it('round-trips encoded permissions without dropping fields', () => {
		const permissions = ['households:write', 'recipes:read', 'meals:write'];
		const encoded = Effect.runSync(encodeMembershipPermissions(permissions));
		expect(Effect.runSync(decodeMembershipPermissions(encoded))).toEqual(permissions);
	});

	it('round-trips the complete versioned sync payload', () => {
		const envelope = {
			schemaVersion: 1 as const,
			payload: {
				id: '0198d5af-c8cc-7d5d-90ec-56893f659c75',
				locale: 'nl-NL',
				aliases: [{ value: 'aubergine', sourceDomain: null }],
				conversion: { factor: 28.349523125, offset: 0 },
				deletedAt: null
			}
		};
		const encoded = Effect.runSync(encodeSyncPayload(envelope));
		expect(Effect.runSync(decodeSyncPayload(encoded))).toEqual(envelope);
	});

	it('returns a tagged error for malformed persisted JSON', () => {
		const result = Effect.runSync(Effect.either(decodeMembershipPermissions('{not-json')));
		expect(Either.isLeft(result)).toBe(true);
		if (Either.isLeft(result)) {
			expect(result.left._tag).toBe('D1RowDecodeError');
			expect(result.left.table).toBe('household_memberships');
		}
	});

	it('rejects unknown MCP scopes at the persistence boundary', () => {
		const result = Effect.runSync(Effect.either(decodeMcpScopes('["recipes:admin"]')));
		expect(Either.isLeft(result)).toBe(true);
	});

	it('maps SQLite failures to safe tagged errors without retaining raw details', () => {
		const error = toD1WriteError(
			'recipes',
			'insert',
			new Error('UNIQUE constraint failed: recipes.private_payload')
		);
		expect(error).toMatchObject({
			_tag: 'D1WriteError',
			table: 'recipes',
			operation: 'insert',
			code: 'unique'
		});
		expect(JSON.stringify(error)).not.toContain('private_payload');
	});
});

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, json, updatedAt } from './common';

export const householdProfiles = sqliteTable('household_profiles', {
	householdId: text('household_id').primaryKey(),
	defaultServings: integer('default_servings').notNull().default(1),
	weekStartsOn: text('week_starts_on', { enum: ['sunday', 'monday'] })
		.notNull()
		.default('monday'),
	preferredMassUnit: text('preferred_mass_unit', { enum: ['g', 'kg', 'oz', 'lb'] })
		.notNull()
		.default('g'),
	preferredVolumeUnit: text('preferred_volume_unit', {
		enum: ['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl oz']
	})
		.notNull()
		.default('ml'),
	ingredientUnitOverrides: json<Record<string, string>>('ingredient_unit_overrides_json')
		.notNull()
		.default(sql`'{}'`),
	preferredDinnerTime: text('preferred_dinner_time'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const householdAppliances = sqliteTable(
	'household_appliances',
	{
		id: id(),
		householdId: text('household_id').notNull(),
		appliance: text('appliance', {
			enum: [
				'oven',
				'stovetop',
				'microwave',
				'air_fryer',
				'slow_cooker',
				'rice_cooker',
				'blender',
				'food_processor',
				'grill'
			]
		}).notNull(),
		available: integer('available', { mode: 'boolean' }).notNull().default(true),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('household_appliances_household_id_idx').on(table.householdId),
		uniqueIndex('household_appliances_household_appliance_unique').on(
			table.householdId,
			table.appliance
		)
	]
);

export const userCookingProfiles = sqliteTable('user_cooking_profiles', {
	workosUserId: text('workos_user_id').primaryKey(),
	cookTimeCoefficient: real('cook_time_coefficient').notNull().default(1),
	preferredDinnerTime: text('preferred_dinner_time'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

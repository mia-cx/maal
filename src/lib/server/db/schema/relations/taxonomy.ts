import { relations } from 'drizzle-orm';
import {
	foodAliases,
	foodHouseholdAliases,
	foodHouseholdEntries,
	foods,
	foodUserAliases,
	foodUserEntries,
	userFoodPreferences
} from '../food';
import {
	householdMealIngredients,
	householdMealInstructionEvents,
	householdMealNutritionFacts
} from '../household-meals';
import { households } from '../households';
import { householdFoodDisplayOverrides, userFoodDisplayOverrides } from '../preferences';
import {
	unitAliases,
	unitHouseholdAliases,
	unitHouseholdEntries,
	units,
	unitUserAliases,
	unitUserEntries
} from '../units';
import {
	userRecipeIngredients,
	userRecipeInstructionEvents,
	userRecipeNutritionFacts
} from '../user-recipes';
import { users } from '../users';

export const unitsRelations = relations(units, ({ one, many }) => ({
	baseUnit: one(units, {
		fields: [units.baseUnitId],
		references: [units.id],
		relationName: 'unitBase'
	}),
	derivedUnits: many(units, { relationName: 'unitBase' }),
	aliases: many(unitAliases),
	userAliases: many(unitUserAliases),
	householdAliases: many(unitHouseholdAliases),
	userEntriesUsingBase: many(unitUserEntries),
	householdEntriesUsingBase: many(unitHouseholdEntries),
	foodsUsingDefaultMeasure: many(foods),
	foodAliasesUsingDefaultMeasure: many(foodAliases),
	foodUserAliasesUsingDefaultMeasure: many(foodUserAliases),
	foodHouseholdAliasesUsingDefaultMeasure: many(foodHouseholdAliases),
	foodUserEntriesUsingDefaultMeasure: many(foodUserEntries),
	foodHouseholdEntriesUsingDefaultMeasure: many(foodHouseholdEntries),
	userFoodDisplayOverridesUsingMeasure: many(userFoodDisplayOverrides),
	householdFoodDisplayOverridesUsingMeasure: many(householdFoodDisplayOverrides),
	userRecipeIngredients: many(userRecipeIngredients),
	userRecipeInstructionEvents: many(userRecipeInstructionEvents),
	userRecipeNutritionFacts: many(userRecipeNutritionFacts),
	householdMealIngredients: many(householdMealIngredients),
	householdMealInstructionEvents: many(householdMealInstructionEvents),
	householdMealNutritionFacts: many(householdMealNutritionFacts)
}));

export const unitAliasesRelations = relations(unitAliases, ({ one }) => ({
	unit: one(units, {
		fields: [unitAliases.unitId, unitAliases.baseUnitId],
		references: [units.id, units.baseUnitId]
	})
}));

export const unitUserAliasesRelations = relations(unitUserAliases, ({ one }) => ({
	user: one(users, {
		fields: [unitUserAliases.workosUserId],
		references: [users.workosUserId]
	}),
	unit: one(units, {
		fields: [unitUserAliases.unitId, unitUserAliases.baseUnitId],
		references: [units.id, units.baseUnitId]
	})
}));

export const unitHouseholdAliasesRelations = relations(unitHouseholdAliases, ({ one }) => ({
	household: one(households, {
		fields: [unitHouseholdAliases.householdId],
		references: [households.householdId]
	}),
	unit: one(units, {
		fields: [unitHouseholdAliases.unitId, unitHouseholdAliases.baseUnitId],
		references: [units.id, units.baseUnitId]
	})
}));

export const unitUserEntriesRelations = relations(unitUserEntries, ({ one }) => ({
	user: one(users, {
		fields: [unitUserEntries.workosUserId],
		references: [users.workosUserId]
	}),
	baseUnit: one(units, {
		fields: [unitUserEntries.baseUnitId],
		references: [units.id]
	})
}));

export const unitHouseholdEntriesRelations = relations(unitHouseholdEntries, ({ one }) => ({
	household: one(households, {
		fields: [unitHouseholdEntries.householdId],
		references: [households.householdId]
	}),
	baseUnit: one(units, {
		fields: [unitHouseholdEntries.baseUnitId],
		references: [units.id]
	})
}));

export const foodsRelations = relations(foods, ({ one, many }) => ({
	defaultMeasureUnit: one(units, {
		fields: [foods.defaultMeasureUnitId, foods.defaultMeasureBaseUnitId],
		references: [units.id, units.baseUnitId]
	}),
	aliases: many(foodAliases),
	userAliases: many(foodUserAliases),
	householdAliases: many(foodHouseholdAliases),
	userPreferences: many(userFoodPreferences),
	userDisplayOverrides: many(userFoodDisplayOverrides),
	householdDisplayOverrides: many(householdFoodDisplayOverrides),
	userRecipeIngredients: many(userRecipeIngredients),
	householdMealIngredients: many(householdMealIngredients)
}));

export const foodAliasesRelations = relations(foodAliases, ({ one }) => ({
	food: one(foods, {
		fields: [foodAliases.foodId],
		references: [foods.id]
	}),
	defaultMeasureUnit: one(units, {
		fields: [foodAliases.defaultMeasureUnitId, foodAliases.defaultMeasureBaseUnitId],
		references: [units.id, units.baseUnitId]
	})
}));

export const foodUserAliasesRelations = relations(foodUserAliases, ({ one }) => ({
	user: one(users, {
		fields: [foodUserAliases.workosUserId],
		references: [users.workosUserId]
	}),
	food: one(foods, {
		fields: [foodUserAliases.foodId],
		references: [foods.id]
	}),
	defaultMeasureUnit: one(units, {
		fields: [foodUserAliases.defaultMeasureUnitId, foodUserAliases.defaultMeasureBaseUnitId],
		references: [units.id, units.baseUnitId]
	})
}));

export const foodHouseholdAliasesRelations = relations(foodHouseholdAliases, ({ one }) => ({
	household: one(households, {
		fields: [foodHouseholdAliases.householdId],
		references: [households.householdId]
	}),
	food: one(foods, {
		fields: [foodHouseholdAliases.foodId],
		references: [foods.id]
	}),
	defaultMeasureUnit: one(units, {
		fields: [
			foodHouseholdAliases.defaultMeasureUnitId,
			foodHouseholdAliases.defaultMeasureBaseUnitId
		],
		references: [units.id, units.baseUnitId]
	})
}));

export const foodUserEntriesRelations = relations(foodUserEntries, ({ one }) => ({
	user: one(users, {
		fields: [foodUserEntries.workosUserId],
		references: [users.workosUserId]
	}),
	defaultMeasureUnit: one(units, {
		fields: [foodUserEntries.defaultMeasureUnitId, foodUserEntries.defaultMeasureBaseUnitId],
		references: [units.id, units.baseUnitId]
	})
}));

export const foodHouseholdEntriesRelations = relations(foodHouseholdEntries, ({ one }) => ({
	household: one(households, {
		fields: [foodHouseholdEntries.householdId],
		references: [households.householdId]
	}),
	defaultMeasureUnit: one(units, {
		fields: [
			foodHouseholdEntries.defaultMeasureUnitId,
			foodHouseholdEntries.defaultMeasureBaseUnitId
		],
		references: [units.id, units.baseUnitId]
	})
}));

export const userFoodPreferencesRelations = relations(userFoodPreferences, ({ one }) => ({
	user: one(users, {
		fields: [userFoodPreferences.workosUserId],
		references: [users.workosUserId]
	}),
	food: one(foods, {
		fields: [userFoodPreferences.foodId],
		references: [foods.id]
	})
}));

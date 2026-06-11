import { relations } from 'drizzle-orm';
import {
	foodHouseholdAliases,
	foodHouseholdEntries,
	foodUserAliases,
	foodUserEntries,
	userFoodPreferences
} from '../food';
import { householdMeals } from '../household-meals';
import { householdAppliances, households } from '../households';
import { mealCheckIns } from '../meal-check-ins';
import {
	householdFoodDisplayOverrides,
	householdUnitDisplayOverrides,
	userFoodDisplayOverrides,
	userUnitDisplayOverrides
} from '../preferences';
import {
	unitHouseholdAliases,
	unitHouseholdEntries,
	unitUserAliases,
	unitUserEntries
} from '../units';
import { userRecipes } from '../user-recipes';
import { users } from '../users';

export const usersRelations = relations(users, ({ many }) => ({
	userRecipes: many(userRecipes),
	plannedHouseholdMeals: many(householdMeals, { relationName: 'plannedCook' }),
	mealCheckIns: many(mealCheckIns),
	foodAliases: many(foodUserAliases),
	foodEntries: many(foodUserEntries),
	unitAliases: many(unitUserAliases),
	unitEntries: many(unitUserEntries),
	foodPreferences: many(userFoodPreferences),
	foodDisplayOverrides: many(userFoodDisplayOverrides),
	unitDisplayOverrides: many(userUnitDisplayOverrides)
}));

export const householdsRelations = relations(households, ({ many }) => ({
	appliances: many(householdAppliances),
	meals: many(householdMeals),
	savedUserRecipes: many(userRecipes, { relationName: 'savedFromHousehold' }),
	foodAliases: many(foodHouseholdAliases),
	foodEntries: many(foodHouseholdEntries),
	unitAliases: many(unitHouseholdAliases),
	unitEntries: many(unitHouseholdEntries),
	foodDisplayOverrides: many(householdFoodDisplayOverrides),
	unitDisplayOverrides: many(householdUnitDisplayOverrides)
}));

export const householdAppliancesRelations = relations(householdAppliances, ({ one }) => ({
	household: one(households, {
		fields: [householdAppliances.householdId],
		references: [households.householdId]
	})
}));

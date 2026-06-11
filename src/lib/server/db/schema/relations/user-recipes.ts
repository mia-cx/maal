import { relations } from 'drizzle-orm';
import { foods } from '../food';
import { householdMealUserRecipes } from '../household-meals';
import { households } from '../households';
import { units } from '../units';
import {
	userRecipeApplianceRequirements,
	userRecipeClassifications,
	userRecipeIngredients,
	userRecipeInstructionEvents,
	userRecipeInstructions,
	userRecipeMedia,
	userRecipeNutritionFacts,
	userRecipes
} from '../user-recipes';
import { users } from '../users';

export const userRecipesRelations = relations(userRecipes, ({ one, many }) => ({
	user: one(users, {
		fields: [userRecipes.workosUserId],
		references: [users.workosUserId]
	}),
	savedFromHousehold: one(households, {
		fields: [userRecipes.savedFromHouseholdId],
		references: [households.householdId],
		relationName: 'savedFromHousehold'
	}),
	ingredients: many(userRecipeIngredients),
	instructions: many(userRecipeInstructions),
	applianceRequirements: many(userRecipeApplianceRequirements),
	classifications: many(userRecipeClassifications),
	media: many(userRecipeMedia),
	nutritionFacts: many(userRecipeNutritionFacts),
	householdMealLinks: many(householdMealUserRecipes)
}));

export const userRecipeIngredientsRelations = relations(userRecipeIngredients, ({ one }) => ({
	userRecipe: one(userRecipes, {
		fields: [userRecipeIngredients.userRecipeId],
		references: [userRecipes.id]
	}),
	baseFood: one(foods, {
		fields: [userRecipeIngredients.baseFoodId],
		references: [foods.id]
	}),
	baseUnit: one(units, {
		fields: [userRecipeIngredients.baseUnitId, userRecipeIngredients.baseUnitFamilyId],
		references: [units.id, units.baseUnitId]
	})
}));

export const userRecipeInstructionsRelations = relations(
	userRecipeInstructions,
	({ one, many }) => ({
		userRecipe: one(userRecipes, {
			fields: [userRecipeInstructions.userRecipeId],
			references: [userRecipes.id]
		}),
		events: many(userRecipeInstructionEvents)
	})
);

export const userRecipeInstructionEventsRelations = relations(
	userRecipeInstructionEvents,
	({ one }) => ({
		instruction: one(userRecipeInstructions, {
			fields: [userRecipeInstructionEvents.userRecipeInstructionId],
			references: [userRecipeInstructions.id]
		}),
		unit: one(units, {
			fields: [userRecipeInstructionEvents.unitId, userRecipeInstructionEvents.baseUnitId],
			references: [units.id, units.baseUnitId]
		})
	})
);

export const userRecipeApplianceRequirementsRelations = relations(
	userRecipeApplianceRequirements,
	({ one }) => ({
		userRecipe: one(userRecipes, {
			fields: [userRecipeApplianceRequirements.userRecipeId],
			references: [userRecipes.id]
		})
	})
);

export const userRecipeClassificationsRelations = relations(
	userRecipeClassifications,
	({ one }) => ({
		userRecipe: one(userRecipes, {
			fields: [userRecipeClassifications.userRecipeId],
			references: [userRecipes.id]
		})
	})
);

export const userRecipeMediaRelations = relations(userRecipeMedia, ({ one }) => ({
	userRecipe: one(userRecipes, {
		fields: [userRecipeMedia.userRecipeId],
		references: [userRecipes.id]
	})
}));

export const userRecipeNutritionFactsRelations = relations(userRecipeNutritionFacts, ({ one }) => ({
	userRecipe: one(userRecipes, {
		fields: [userRecipeNutritionFacts.userRecipeId],
		references: [userRecipes.id]
	}),
	unit: one(units, {
		fields: [userRecipeNutritionFacts.unitId, userRecipeNutritionFacts.baseUnitId],
		references: [units.id, units.baseUnitId]
	})
}));

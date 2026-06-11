import { relations } from 'drizzle-orm';
import { foods } from '../food';
import {
	householdMealApplianceRequirements,
	householdMealClassifications,
	householdMealIngredients,
	householdMealInstructionEvents,
	householdMealInstructions,
	householdMealMedia,
	householdMealNutritionFacts,
	householdMeals,
	householdMealUserRecipes
} from '../household-meals';
import { households } from '../households';
import { mealCheckIns } from '../meal-check-ins';
import { units } from '../units';
import { userRecipes } from '../user-recipes';
import { users } from '../users';

export const householdMealsRelations = relations(householdMeals, ({ one, many }) => ({
	household: one(households, {
		fields: [householdMeals.householdId],
		references: [households.householdId]
	}),
	plannedCook: one(users, {
		fields: [householdMeals.plannedCookWorkosUserId],
		references: [users.workosUserId],
		relationName: 'plannedCook'
	}),
	userRecipeLinks: many(householdMealUserRecipes),
	ingredients: many(householdMealIngredients),
	instructions: many(householdMealInstructions),
	applianceRequirements: many(householdMealApplianceRequirements),
	classifications: many(householdMealClassifications),
	media: many(householdMealMedia),
	nutritionFacts: many(householdMealNutritionFacts),
	checkIns: many(mealCheckIns)
}));

export const householdMealUserRecipesRelations = relations(householdMealUserRecipes, ({ one }) => ({
	householdMeal: one(householdMeals, {
		fields: [householdMealUserRecipes.householdMealId],
		references: [householdMeals.id]
	}),
	userRecipe: one(userRecipes, {
		fields: [householdMealUserRecipes.userRecipeId],
		references: [userRecipes.id]
	})
}));

export const householdMealIngredientsRelations = relations(householdMealIngredients, ({ one }) => ({
	householdMeal: one(householdMeals, {
		fields: [householdMealIngredients.householdMealId],
		references: [householdMeals.id]
	}),
	baseFood: one(foods, {
		fields: [householdMealIngredients.baseFoodId],
		references: [foods.id]
	}),
	baseUnit: one(units, {
		fields: [householdMealIngredients.baseUnitId, householdMealIngredients.baseUnitFamilyId],
		references: [units.id, units.baseUnitId]
	})
}));

export const householdMealInstructionsRelations = relations(
	householdMealInstructions,
	({ one, many }) => ({
		householdMeal: one(householdMeals, {
			fields: [householdMealInstructions.householdMealId],
			references: [householdMeals.id]
		}),
		events: many(householdMealInstructionEvents)
	})
);

export const householdMealInstructionEventsRelations = relations(
	householdMealInstructionEvents,
	({ one }) => ({
		instruction: one(householdMealInstructions, {
			fields: [householdMealInstructionEvents.householdMealInstructionId],
			references: [householdMealInstructions.id]
		}),
		unit: one(units, {
			fields: [householdMealInstructionEvents.unitId, householdMealInstructionEvents.baseUnitId],
			references: [units.id, units.baseUnitId]
		})
	})
);

export const householdMealApplianceRequirementsRelations = relations(
	householdMealApplianceRequirements,
	({ one }) => ({
		householdMeal: one(householdMeals, {
			fields: [householdMealApplianceRequirements.householdMealId],
			references: [householdMeals.id]
		})
	})
);

export const householdMealClassificationsRelations = relations(
	householdMealClassifications,
	({ one }) => ({
		householdMeal: one(householdMeals, {
			fields: [householdMealClassifications.householdMealId],
			references: [householdMeals.id]
		})
	})
);

export const householdMealMediaRelations = relations(householdMealMedia, ({ one }) => ({
	householdMeal: one(householdMeals, {
		fields: [householdMealMedia.householdMealId],
		references: [householdMeals.id]
	})
}));

export const householdMealNutritionFactsRelations = relations(
	householdMealNutritionFacts,
	({ one }) => ({
		householdMeal: one(householdMeals, {
			fields: [householdMealNutritionFacts.householdMealId],
			references: [householdMeals.id]
		}),
		unit: one(units, {
			fields: [householdMealNutritionFacts.unitId, householdMealNutritionFacts.baseUnitId],
			references: [units.id, units.baseUnitId]
		})
	})
);

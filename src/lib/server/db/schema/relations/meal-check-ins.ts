import { relations } from 'drizzle-orm';
import { householdMeals } from '../household-meals';
import { mealCheckIns } from '../meal-check-ins';
import { users } from '../users';

export const mealCheckInsRelations = relations(mealCheckIns, ({ one }) => ({
	user: one(users, {
		fields: [mealCheckIns.workosUserId],
		references: [users.workosUserId]
	}),
	householdMeal: one(householdMeals, {
		fields: [mealCheckIns.householdMealId],
		references: [householdMeals.id]
	})
}));

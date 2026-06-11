import { relations } from 'drizzle-orm';
import { foods } from '../food';
import { households } from '../households';
import {
	householdFoodDisplayOverrides,
	householdUnitDisplayOverrides,
	userFoodDisplayOverrides,
	userUnitDisplayOverrides
} from '../preferences';
import { units } from '../units';
import { users } from '../users';

export const userFoodDisplayOverridesRelations = relations(userFoodDisplayOverrides, ({ one }) => ({
	user: one(users, {
		fields: [userFoodDisplayOverrides.workosUserId],
		references: [users.workosUserId]
	}),
	food: one(foods, {
		fields: [userFoodDisplayOverrides.foodId],
		references: [foods.id]
	}),
	preferredMeasureUnit: one(units, {
		fields: [
			userFoodDisplayOverrides.preferredMeasureUnitId,
			userFoodDisplayOverrides.preferredMeasureBaseUnitId
		],
		references: [units.id, units.baseUnitId]
	})
}));

export const householdFoodDisplayOverridesRelations = relations(
	householdFoodDisplayOverrides,
	({ one }) => ({
		household: one(households, {
			fields: [householdFoodDisplayOverrides.householdId],
			references: [households.householdId]
		}),
		food: one(foods, {
			fields: [householdFoodDisplayOverrides.foodId],
			references: [foods.id]
		}),
		preferredMeasureUnit: one(units, {
			fields: [
				householdFoodDisplayOverrides.preferredMeasureUnitId,
				householdFoodDisplayOverrides.preferredMeasureBaseUnitId
			],
			references: [units.id, units.baseUnitId]
		})
	})
);

export const userUnitDisplayOverridesRelations = relations(userUnitDisplayOverrides, ({ one }) => ({
	user: one(users, {
		fields: [userUnitDisplayOverrides.workosUserId],
		references: [users.workosUserId]
	}),
	baseUnit: one(units, {
		fields: [userUnitDisplayOverrides.baseUnitId],
		references: [units.id],
		relationName: 'userUnitDisplayOverrideBase'
	}),
	preferredUnit: one(units, {
		fields: [userUnitDisplayOverrides.preferredUnitId, userUnitDisplayOverrides.baseUnitId],
		references: [units.id, units.baseUnitId],
		relationName: 'userUnitDisplayOverridePreferred'
	})
}));

export const householdUnitDisplayOverridesRelations = relations(
	householdUnitDisplayOverrides,
	({ one }) => ({
		household: one(households, {
			fields: [householdUnitDisplayOverrides.householdId],
			references: [households.householdId]
		}),
		baseUnit: one(units, {
			fields: [householdUnitDisplayOverrides.baseUnitId],
			references: [units.id],
			relationName: 'householdUnitDisplayOverrideBase'
		}),
		preferredUnit: one(units, {
			fields: [
				householdUnitDisplayOverrides.preferredUnitId,
				householdUnitDisplayOverrides.baseUnitId
			],
			references: [units.id, units.baseUnitId],
			relationName: 'householdUnitDisplayOverridePreferred'
		})
	})
);

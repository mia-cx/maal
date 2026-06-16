import { eq, inArray } from 'drizzle-orm';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { getDb } from '$lib/server/db';
import {
	billingSubscriptions,
	foodHouseholdAliases,
	foodHouseholdEntries,
	householdAppliances,
	householdFoodDisplayOverrides,
	householdInvites,
	householdMealApplianceRequirements,
	householdMealClassifications,
	householdMealIngredients,
	householdMealInstructionEvents,
	householdMealInstructions,
	householdMealMedia,
	householdMealNutritionFacts,
	householdMeals,
	households,
	householdMealUserRecipes,
	householdUnitDisplayOverrides,
	unitHouseholdAliases,
	unitHouseholdEntries,
	userRecipes
} from '$lib/server/db/schema';

export const deleteHouseholdCascade = async ({
	database,
	platform,
	householdId
}: {
	database: D1Database;
	platform: App.Platform;
	householdId: string;
}) => {
	const db = getDb(database);
	const mealRows = await db
		.select({ id: householdMeals.id })
		.from(householdMeals)
		.where(eq(householdMeals.householdId, householdId));
	const mealIds = mealRows.map((meal) => meal.id);
	const instructionRows = mealIds.length
		? await db
				.select({ id: householdMealInstructions.id })
				.from(householdMealInstructions)
				.where(inArray(householdMealInstructions.householdMealId, mealIds))
		: [];
	const instructionIds = instructionRows.map((instruction) => instruction.id);

	await createAuthRuntime(platform).workos.organizations.deleteOrganization(householdId);

	if (instructionIds.length > 0) {
		await db
			.delete(householdMealInstructionEvents)
			.where(inArray(householdMealInstructionEvents.householdMealInstructionId, instructionIds));
	}

	if (mealIds.length > 0) {
		await db
			.delete(householdMealUserRecipes)
			.where(inArray(householdMealUserRecipes.householdMealId, mealIds));
		await db
			.delete(householdMealIngredients)
			.where(inArray(householdMealIngredients.householdMealId, mealIds));
		await db
			.delete(householdMealApplianceRequirements)
			.where(inArray(householdMealApplianceRequirements.householdMealId, mealIds));
		await db
			.delete(householdMealInstructions)
			.where(inArray(householdMealInstructions.householdMealId, mealIds));
		await db
			.delete(householdMealClassifications)
			.where(inArray(householdMealClassifications.householdMealId, mealIds));
		await db.delete(householdMealMedia).where(inArray(householdMealMedia.householdMealId, mealIds));
		await db
			.delete(householdMealNutritionFacts)
			.where(inArray(householdMealNutritionFacts.householdMealId, mealIds));
	}

	await db.delete(householdMeals).where(eq(householdMeals.householdId, householdId));
	await db.delete(billingSubscriptions).where(eq(billingSubscriptions.householdId, householdId));
	await db.delete(householdInvites).where(eq(householdInvites.householdId, householdId));
	await db
		.delete(householdFoodDisplayOverrides)
		.where(eq(householdFoodDisplayOverrides.householdId, householdId));
	await db
		.delete(householdUnitDisplayOverrides)
		.where(eq(householdUnitDisplayOverrides.householdId, householdId));
	await db.delete(foodHouseholdAliases).where(eq(foodHouseholdAliases.householdId, householdId));
	await db.delete(foodHouseholdEntries).where(eq(foodHouseholdEntries.householdId, householdId));
	await db.delete(unitHouseholdAliases).where(eq(unitHouseholdAliases.householdId, householdId));
	await db.delete(unitHouseholdEntries).where(eq(unitHouseholdEntries.householdId, householdId));
	await db.delete(householdAppliances).where(eq(householdAppliances.householdId, householdId));
	await db
		.update(userRecipes)
		.set({ savedFromHouseholdId: null })
		.where(eq(userRecipes.savedFromHouseholdId, householdId));
	await db.delete(households).where(eq(households.householdId, householdId));
};

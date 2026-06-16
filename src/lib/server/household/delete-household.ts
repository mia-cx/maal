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

	await db.transaction(async (tx) => {
		if (instructionIds.length > 0) {
			await tx
				.delete(householdMealInstructionEvents)
				.where(inArray(householdMealInstructionEvents.householdMealInstructionId, instructionIds));
		}

		if (mealIds.length > 0) {
			await tx
				.delete(householdMealUserRecipes)
				.where(inArray(householdMealUserRecipes.householdMealId, mealIds));
			await tx
				.delete(householdMealIngredients)
				.where(inArray(householdMealIngredients.householdMealId, mealIds));
			await tx
				.delete(householdMealApplianceRequirements)
				.where(inArray(householdMealApplianceRequirements.householdMealId, mealIds));
			await tx
				.delete(householdMealInstructions)
				.where(inArray(householdMealInstructions.householdMealId, mealIds));
			await tx
				.delete(householdMealClassifications)
				.where(inArray(householdMealClassifications.householdMealId, mealIds));
			await tx
				.delete(householdMealMedia)
				.where(inArray(householdMealMedia.householdMealId, mealIds));
			await tx
				.delete(householdMealNutritionFacts)
				.where(inArray(householdMealNutritionFacts.householdMealId, mealIds));
		}

		await tx.delete(householdMeals).where(eq(householdMeals.householdId, householdId));
		await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.householdId, householdId));
		await tx.delete(householdInvites).where(eq(householdInvites.householdId, householdId));
		await tx
			.delete(householdFoodDisplayOverrides)
			.where(eq(householdFoodDisplayOverrides.householdId, householdId));
		await tx
			.delete(householdUnitDisplayOverrides)
			.where(eq(householdUnitDisplayOverrides.householdId, householdId));
		await tx.delete(foodHouseholdAliases).where(eq(foodHouseholdAliases.householdId, householdId));
		await tx.delete(foodHouseholdEntries).where(eq(foodHouseholdEntries.householdId, householdId));
		await tx.delete(unitHouseholdAliases).where(eq(unitHouseholdAliases.householdId, householdId));
		await tx.delete(unitHouseholdEntries).where(eq(unitHouseholdEntries.householdId, householdId));
		await tx.delete(householdAppliances).where(eq(householdAppliances.householdId, householdId));
		await tx
			.update(userRecipes)
			.set({ savedFromHouseholdId: null })
			.where(eq(userRecipes.savedFromHouseholdId, householdId));
		await tx.delete(households).where(eq(households.householdId, householdId));
	});

	await createAuthRuntime(platform).workos.organizations.deleteOrganization(householdId);
};

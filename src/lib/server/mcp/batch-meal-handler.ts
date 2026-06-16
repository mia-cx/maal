import { createHouseholdMeal } from '$lib/server/domains/planning';
import { isRecord, text } from './scalars';
import { toolError } from './results';
import { createMealResolvingRecipe, mealFailureLabel } from './meal-input';
import type { McpContext } from './context';

const maxBatchMeals = 50;

export const createBatchHouseholdMeals = async (
	context: McpContext,
	householdId: string,
	args: Record<string, unknown>
) => {
	if (!Array.isArray(args.meals) || args.meals.length === 0) {
		throw toolError('invalid_input', 'Pass between 1 and 50 meals.');
	}
	if (args.meals.length > maxBatchMeals) {
		throw toolError('invalid_input', `Pass no more than ${maxBatchMeals} meals.`);
	}
	const invalidIndex = args.meals.findIndex((meal) => !isRecord(meal));
	if (invalidIndex !== -1) {
		throw toolError('invalid_input', `meals[${invalidIndex}] must be an object.`);
	}
	const meals = args.meals as Record<string, unknown>[];
	const created = [];
	const errors = [];
	for (const [index, mealArgs] of meals.entries()) {
		try {
			created.push(
				await createHouseholdMeal({
					platform: context.platform,
					db: context.db,
					meal: await createMealResolvingRecipe(context, householdId, mealArgs)
				})
			);
		} catch (cause) {
			const mealUrl = text(mealArgs.url);
			const causeMessage = isRecord(cause) ? text(cause.message) : undefined;
			errors.push({
				index,
				meal: mealFailureLabel(mealArgs, index),
				url: mealUrl,
				code: mealUrl ? 'import_or_create_failed' : 'create_failed',
				message: cause instanceof Error ? cause.message : (causeMessage ?? 'Could not create meal.')
			});
		}
	}
	return { created, errors };
};

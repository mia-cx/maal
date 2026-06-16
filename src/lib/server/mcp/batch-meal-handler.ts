import { createHouseholdMeal } from '$lib/server/domains/planning';
import { isRecord, text } from './scalars';
import { toolError } from './results';
import { createMealResolvingRecipe, mealFailureLabel } from './meal-input';
import type { McpContext } from './context';

export const createBatchHouseholdMeals = async (
	context: McpContext,
	householdId: string,
	args: Record<string, unknown>
) => {
	const meals = Array.isArray(args.meals) ? args.meals.filter(isRecord).slice(0, 50) : [];
	if (!meals.length) throw toolError('invalid_input', 'Pass between 1 and 50 meals.');
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
			errors.push({
				index,
				meal: mealFailureLabel(mealArgs, index),
				url: text(mealArgs.url),
				code: text(mealArgs.url) ? 'import_or_create_failed' : 'create_failed',
				message: cause instanceof Error ? cause.message : 'Could not create meal.'
			});
		}
	}
	return { created, errors };
};

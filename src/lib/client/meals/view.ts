import type { RecipeMenuItem } from '$lib/components/menu/index.js';
import type {
	HouseholdMember,
	Meal,
	MealCheckIn as ScheduleMealCheckIn,
	MealFamiliarity
} from '$lib/components/dashboard/schedule-types.js';
import type { Membership, Profile } from '$lib/domain/household/contracts.js';
import type { MealAggregate, MealCheckIn } from '$lib/domain/meals/schema.js';
import type { RecipeAggregate } from '$lib/domain/recipes/schema.js';
import { recipeAggregateToMenuItem } from '$lib/menu/recipe-local-adapter.js';

const familiarityFromCheckIn = (checkIn: MealCheckIn | undefined): MealFamiliarity | undefined => {
	if (checkIn?.verdict === 'repeat') return 'safe';
	if (checkIn?.verdict === 'avoid') return 'wildcard';
	if (checkIn?.verdict === 'neutral') return 'exploration';
};

const scheduleCheckIn = (checkIn: MealCheckIn | undefined): ScheduleMealCheckIn | undefined =>
	checkIn
		? {
				verdict: checkIn.verdict,
				...(checkIn.cookTimeMinutes === null ? {} : { cookTime: checkIn.cookTimeMinutes }),
				...(checkIn.reason === null ? {} : { reason: checkIn.reason })
			}
		: undefined;

export const mealAggregateToScheduleMeal = (
	meal: MealAggregate,
	checkIn?: MealCheckIn,
	householdTimeZone?: string
): Meal => ({
	id: meal.id,
	...(meal.sourceRecipeId === null ? {} : { userRecipeId: meal.sourceRecipeId }),
	title: meal.title,
	...(meal.date === null ? {} : { date: meal.date }),
	...(meal.time === null ? {} : { time: meal.time }),
	...(meal.sortOrder === null ? {} : { sortOrder: meal.sortOrder }),
	status: meal.status,
	...(meal.plannedCookUserId === null ? {} : { plannedCookWorkosUserId: meal.plannedCookUserId }),
	...(meal.prepTimeMinutes === null ? {} : { prepTimeMinutes: meal.prepTimeMinutes }),
	...(meal.cookTimeMinutes === null ? {} : { cookTimeMinutes: meal.cookTimeMinutes }),
	...(checkIn?.cookTimeMinutes === null || checkIn === undefined
		? {}
		: { adjustedCookTimeMinutes: checkIn.cookTimeMinutes }),
	...(meal.plannedYield === null ? {} : { servingsPlanned: meal.plannedYield }),
	...(meal.yield === null ? {} : { baseServings: meal.yield }),
	...(familiarityFromCheckIn(checkIn) ? { familiarity: familiarityFromCheckIn(checkIn) } : {}),
	...(meal.imageUrl === null ? {} : { image: meal.imageUrl }),
	...(meal.description === null ? {} : { description: meal.description }),
	ingredients: meal.ingredients
		.toSorted((left, right) => left.lineIndex - right.lineIndex)
		.map(({ originalText }) => originalText),
	instructions: meal.instructions
		.toSorted((left, right) => left.stepIndex - right.stepIndex)
		.map(({ text }) => text),
	...(checkIn ? { latestVerdict: checkIn.verdict, latestCheckIn: scheduleCheckIn(checkIn) } : {}),
	...(householdTimeZone ? { householdTimeZone } : {})
});

export const recipeAggregateToPoolMeal = (recipe: RecipeAggregate): Meal => {
	const item = recipeAggregateToMenuItem(recipe);
	return {
		id: recipe.id,
		userRecipeId: recipe.id,
		title: recipe.title,
		sortOrder: 0,
		...(recipe.cookTimeMinutes === null ? {} : { cookTimeMinutes: recipe.cookTimeMinutes }),
		...(recipe.yield === null ? {} : { servingsPlanned: recipe.yield, baseServings: recipe.yield }),
		...(recipe.imageUrl === null ? {} : { image: recipe.imageUrl }),
		...(recipe.description === null ? {} : { description: recipe.description }),
		ingredients: recipe.ingredients
			.toSorted((left, right) => left.lineIndex - right.lineIndex)
			.map(({ originalText }) => originalText),
		instructions: recipe.instructions
			.toSorted((left, right) => left.stepIndex - right.stepIndex)
			.map(({ text }) => text),
		familiarity: item.latestVerdict === 'avoid' ? 'wildcard' : 'safe'
	};
};

export const recipeAggregateToPickerItem = (recipe: RecipeAggregate): RecipeMenuItem =>
	recipeAggregateToMenuItem(recipe);

export const membershipsToHouseholdMembers = (
	memberships: readonly Membership[],
	profiles: readonly Profile[]
): HouseholdMember[] => {
	const profilesByUserId = new Map(profiles.map((profile) => [profile.workosUserId, profile]));
	return memberships
		.filter(({ status }) => status !== 'revoked')
		.map((membership) => {
			const profile = profilesByUserId.get(membership.workosUserId);
			return {
				id: membership.membershipId,
				userId: membership.workosUserId,
				name: profile?.displayName ?? profile?.email ?? 'Household member',
				email: profile?.email ?? '',
				role: membership.roleSlug
			};
		});
};

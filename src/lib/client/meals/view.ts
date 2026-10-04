import type { RecipeMenuItem } from '$lib/components/menu/index.js';
import type {
	HouseholdMember,
	Meal,
	MealCheckIn as ScheduleMealCheckIn
} from '$lib/components/dashboard/schedule-types.js';
import type { UserAttributionRecord } from '$lib/client/local/records.js';
import type { Membership, Profile } from '$lib/domain/household/contracts.js';
import type { MealAggregate, MealCheckIn } from '$lib/domain/meals/schema.js';
import type { RecipeAggregate } from '$lib/domain/recipes/schema.js';
import { recipeAggregateToMenuItem } from '$lib/menu/recipe-local-adapter.js';

const scheduleCheckIn = (checkIn: MealCheckIn | undefined): ScheduleMealCheckIn | undefined =>
	checkIn
		? {
				verdict: checkIn.verdict,
				...(checkIn.cookTimeMinutes === null ? {} : { cookTime: checkIn.cookTimeMinutes }),
				...(checkIn.reason === null ? {} : { reason: checkIn.reason })
			}
		: undefined;

/**
 * Maps a stored meal to the schedule's view model. Pass only the active profile's own check-in:
 * it fills the card's check-in state and the check-in dialog. Like the prototype, a meal carries no
 * familiarity or adjusted cook time, so cards use the neutral load default.
 */
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
	...(meal.plannedYield === null ? {} : { servingsPlanned: meal.plannedYield }),
	...(meal.yield === null ? {} : { baseServings: meal.yield }),
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

export const recipeAggregateToPickerItem = (recipe: RecipeAggregate): RecipeMenuItem =>
	recipeAggregateToMenuItem(recipe);

/**
 * Lists the members who can cook a meal: active memberships only, named like household settings
 * from a local profile first, then the synced user attribution.
 */
export const membershipsToHouseholdMembers = (
	memberships: readonly Membership[],
	profiles: readonly Profile[],
	attributions: readonly UserAttributionRecord[]
): HouseholdMember[] => {
	const profilesByUserId = new Map(profiles.map((profile) => [profile.workosUserId, profile]));
	const attributionsByUserId = new Map(
		attributions.map((attribution) => [attribution.workosUserId, attribution])
	);
	return memberships
		.filter(({ status }) => status === 'active')
		.map((membership) => {
			const profile = profilesByUserId.get(membership.workosUserId);
			const attribution = attributionsByUserId.get(membership.workosUserId);
			return {
				id: membership.membershipId,
				userId: membership.workosUserId,
				name: profile?.displayName ?? attribution?.displayName ?? membership.workosUserId,
				email: profile?.email ?? attribution?.email ?? '',
				role: membership.roleSlug
			};
		});
};

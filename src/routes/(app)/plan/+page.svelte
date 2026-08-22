<script lang="ts">
	import { liveQuery } from 'dexie';
	import { Schema } from 'effect';
	import { onMount } from 'svelte';

	import {
		deleteMeal,
		liveMealCalendarRange,
		mealAggregateToScheduleMeal,
		membershipsToHouseholdMembers,
		planRecipeAsMeal,
		readScheduleUiState,
		recipeAggregateToPickerItem,
		recipeAggregateToPoolMeal,
		saveMealCheckIn,
		updateMealSchedule,
		writeScheduleUiState,
		type MealCalendarRange,
		type MealCommandContext,
		type ScheduleUiState
	} from '$lib/client/meals/index.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import { activeHouseholdKey } from '$lib/client/local/profiles.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { createRecipeFromEditor, listRecipes } from '$lib/client/recipes/index.js';
	import ScheduleDashboard from '$lib/components/dashboard/schedule-dashboard.svelte';
	import type {
		HouseholdMember,
		Meal,
		MealDropTarget
	} from '$lib/components/dashboard/schedule-types.js';
	import type { MealCheckInPayload } from '$lib/components/dashboard/meal-check-in-dialog.svelte';
	import { sortOrderForUntimedInsertion } from '$lib/components/dashboard/schedule-ordering.js';
	import type { RecipeMenuItem } from '$lib/components/menu/index.js';
	import { DomainIdSchema } from '$lib/domain/contracts/primitives.js';
	import { recipeMenuItemToEditorPatch } from '$lib/menu/recipe-local-adapter.js';

	type PlanView = {
		profileId: string;
		userId: string;
		householdId: string;
		defaultMealServings: number;
		weekStartsOn: 'sunday' | 'monday';
		householdTimeZone?: string;
		mealPool: Meal[];
		recipes: RecipeMenuItem[];
		householdMembers: HouseholdMember[];
		uiState: ScheduleUiState;
	};

	let database = $state<MaalDatabase | null>(null);
	let view = $state<PlanView | null>(null);
	let calendarMeals = $state<Meal[]>([]);
	let renderedMealRange = $state<MealCalendarRange | null>(null);
	let error = $state<string | null>(null);
	const dashboardMeals = $derived(view ? [...calendarMeals, ...view.mealPool] : []);

	const commandContext = async (): Promise<MealCommandContext> => {
		if (!database || !view) throw new Error('Choose a local household first.');
		const slot = await database.authSlots.where('profileId').equals(view.profileId).first();
		const device = await database.meta.get('deviceId');
		return {
			authSlotId: slot?.authSlotId ?? `signed-out:${view.profileId}`,
			householdId: view.householdId,
			reporterUserId: view.userId,
			originDeviceId: Schema.decodeUnknownSync(DomainIdSchema)(device?.value)
		};
	};

	const planRecipe = async (
		recipe: RecipeMenuItem,
		date?: string,
		target?: MealDropTarget
	): Promise<Meal> => {
		if (!database || !view) throw new Error('Local meal storage is still opening.');
		const sortOrder =
			target?.kind === 'date'
				? sortOrderForUntimedInsertion(calendarMeals, target.date, target.index)
				: null;
		const planned = await planRecipeAsMeal(database, await commandContext(), recipe.id, {
			date: date ?? null,
			sortOrder,
			plannedYield: view.defaultMealServings
		});
		return mealAggregateToScheduleMeal(planned, undefined, view.householdTimeZone);
	};

	const changeMeal = async (meal: Meal): Promise<void> => {
		if (!database) throw new Error('Local meal storage is still opening.');
		await updateMealSchedule(database, await commandContext(), meal.id, {
			date: meal.date ?? null,
			time: meal.time ?? null,
			sortOrder: meal.sortOrder ?? null,
			plannedCookUserId: meal.plannedCookWorkosUserId ?? null,
			plannedYield: meal.servingsPlanned ?? null
		});
	};

	const removeMeal = async (meal: Meal): Promise<void> => {
		if (!database) throw new Error('Local meal storage is still opening.');
		await deleteMeal(database, await commandContext(), meal.id);
	};

	const checkIn = async (payload: MealCheckInPayload): Promise<Meal> => {
		if (!database) throw new Error('Local meal storage is still opening.');
		const result = await saveMealCheckIn(database, await commandContext(), payload.meal.id, {
			status: payload.cooked ? 'cooked' : 'skipped',
			verdict: payload.verdict,
			cookTimeMinutes: payload.cookTime ?? null,
			reason: payload.reason ?? null
		});
		return mealAggregateToScheduleMeal(result.meal, result.checkIn, view?.householdTimeZone);
	};

	const createRecipeAndMeal = async (recipe: RecipeMenuItem, date?: string): Promise<Meal> => {
		if (!database || !view) throw new Error('Local recipe storage is still opening.');
		const recipeContext = {
			...(await commandContext()),
			ownerUserId: view.userId
		};
		const created = await createRecipeFromEditor(
			database,
			recipeContext,
			recipeMenuItemToEditorPatch(recipe)
		);
		return planRecipe(recipeAggregateToPickerItem(created), date);
	};

	const saveUiState = async (state: ScheduleUiState): Promise<void> => {
		if (!database || !view) return;
		await writeScheduleUiState(database, view.profileId, view.householdId, state);
	};

	const updateRenderedMealRange = (range: MealCalendarRange): void => {
		if (renderedMealRange?.start === range.start && renderedMealRange.end === range.end) return;
		renderedMealRange = range;
	};

	onMount(() => {
		let subscription: { unsubscribe: () => void } | undefined;
		void getBrowserDatabase()
			.then((opened) => {
				database = opened;
				subscription = liveQuery(async (): Promise<PlanView | null> => {
					const activeProfile = await opened.uiState.get('activeProfileId');
					if (typeof activeProfile?.value !== 'string') return null;
					const profile = await opened.profiles.get(activeProfile.value);
					if (!profile) return null;
					const activeHousehold = await opened.uiState.get(activeHouseholdKey(profile.profileId));
					if (typeof activeHousehold?.value !== 'string') return null;
					const household = await opened.households.get(activeHousehold.value);
					if (!household) return null;
					const [recipeAggregates, memberships, profiles, uiState] = await Promise.all([
						listRecipes(opened, profile.workosUserId),
						opened.memberships.where('householdId').equals(household.householdId).toArray(),
						opened.profiles.toArray(),
						readScheduleUiState(
							opened,
							profile.profileId,
							household.householdId,
							household.timezone ?? undefined
						)
					]);
					return {
						profileId: profile.profileId,
						userId: profile.workosUserId,
						householdId: household.householdId,
						defaultMealServings: household.defaultPlannedYield,
						weekStartsOn: household.weekStartsOn === 0 ? 'sunday' : 'monday',
						householdTimeZone: household.timezone ?? undefined,
						mealPool: recipeAggregates.map(recipeAggregateToPoolMeal),
						recipes: recipeAggregates.map(recipeAggregateToPickerItem),
						householdMembers: membershipsToHouseholdMembers(memberships, profiles),
						uiState
					};
				}).subscribe({
					next: (nextView) => {
						const previousScope = view ? `${view.profileId}:${view.householdId}` : null;
						const nextScope = nextView ? `${nextView.profileId}:${nextView.householdId}` : null;
						if (previousScope !== nextScope) {
							calendarMeals = [];
							renderedMealRange = null;
						}
						view = nextView;
						error = null;
					},
					error: () => {
						error = 'Your local meal plan could not be read.';
					}
				});
			})
			.catch(() => {
				error = 'Your local meal plan could not be opened.';
			});
		return () => subscription?.unsubscribe();
	});

	$effect(() => {
		const opened = database;
		const activeView = view;
		const range = renderedMealRange;
		if (!opened || !activeView || !range) return;
		const queryScope = `${activeView.profileId}:${activeView.householdId}:${range.start}:${range.end}`;
		const isCurrentQuery = () =>
			view !== null &&
			renderedMealRange !== null &&
			`${view.profileId}:${view.householdId}:${renderedMealRange.start}:${renderedMealRange.end}` ===
				queryScope;
		const subscription = liveMealCalendarRange(opened, activeView.householdId, range).subscribe({
			next: ({ meals, checkIns }) => {
				if (!isCurrentQuery()) return;
				const latestCheckInByMeal = new Map(
					checkIns
						.filter(({ mealId }) => mealId !== null)
						.toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt))
						.map((checkIn) => [checkIn.mealId!, checkIn])
				);
				calendarMeals = meals.map((meal) =>
					mealAggregateToScheduleMeal(
						meal,
						latestCheckInByMeal.get(meal.id),
						activeView.householdTimeZone
					)
				);
				error = null;
			},
			error: () => {
				if (!isCurrentQuery()) return;
				error = 'Your local meal plan could not be read.';
			}
		});
		return () => subscription.unsubscribe();
	});
</script>

<svelte:head><title>Meal plan · Maal</title></svelte:head>

{#if database}
	{#if view}
		{#key `${view.profileId}:${view.householdId}`}
			<ScheduleDashboard
				meals={dashboardMeals}
				recipes={view.recipes}
				weekStartsOn={view.weekStartsOn}
				householdTimeZone={view.householdTimeZone}
				currentUserId={view.userId}
				householdMembers={view.householdMembers}
				initialUiState={view.uiState}
				onplanrecipe={planRecipe}
				onmealchange={changeMeal}
				onmealdelete={removeMeal}
				onmealcheckin={checkIn}
				oncreaterecipe={createRecipeAndMeal}
				onloadedrangechange={updateRenderedMealRange}
				onuistatechange={saveUiState}
			/>
		{/key}
	{:else}
		<div class="grid min-h-svh place-items-center px-6 text-center">
			<p class="text-sm text-muted-foreground">
				{error ?? 'Choose a local profile and household to start planning.'}
			</p>
		</div>
	{/if}
{:else}
	<div class="grid min-h-svh place-items-center bg-background px-6 text-center text-foreground">
		<div class="grid gap-2 text-sm text-muted-foreground">
			<p>{error ?? 'Opening local Maal data…'}</p>
			{#if error}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="text-primary underline underline-offset-4" href="/recovery">Open local recovery</a
				>
			{/if}
		</div>
	</div>
{/if}

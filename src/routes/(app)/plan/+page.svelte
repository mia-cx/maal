<script lang="ts">
	import { liveQuery } from 'dexie';
	import { Schema } from 'effect';
	import { onMount, untrack } from 'svelte';

	import {
		deleteMeal,
		liveMealCalendarRange,
		liveMealPool,
		defaultScheduleUiState,
		mealAggregateToScheduleMeal,
		membershipsToHouseholdMembers,
		planRecipeAsMeal,
		readScheduleUiState,
		recipeAggregateToPickerItem,
		reorderMeals,
		saveMealCheckIn,
		updateMealSchedule,
		writeScheduleUiState,
		type MealCalendarRange,
		type MealCalendarRangeResult,
		type MealCommandContext,
		type ScheduleUiState
	} from '$lib/client/meals/index.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import { activeHouseholdKey } from '$lib/client/local/profiles.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import {
		commitImportedCandidateAndPlanMeal,
		createRecipeAndPlanMeal,
		listRecipes
	} from '$lib/client/recipes/index.js';
	import { fetchRecipeUrlCandidate } from '$lib/client/recipes/url-import.js';
	import ScheduleDashboard from '$lib/components/dashboard/schedule-dashboard.svelte';
	import type { HouseholdMember, Meal } from '$lib/components/dashboard/schedule-types.js';
	import type { MealCheckInPayload } from '$lib/components/dashboard/meal-check-in-dialog.svelte';
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
		recipes: RecipeMenuItem[];
		householdMembers: HouseholdMember[];
	};

	const noMeals: MealCalendarRangeResult = { meals: [], checkIns: [] };
	const readError = 'Your local meal plan could not be read.';
	/** Scroll and mode changes arrive every frame; Dexie gets at most one write per interval. */
	const uiStateWriteIntervalMs = 250;

	let database = $state<MaalDatabase | null>(null);
	let view = $state<PlanView | null>(null);
	let uiState = $state<{ scope: string; state: ScheduleUiState } | null>(null);
	let rangeMeals = $state<MealCalendarRangeResult>(noMeals);
	let poolMeals = $state<MealCalendarRangeResult>(noMeals);
	let renderedMealRange = $state<MealCalendarRange | null>(null);
	let error = $state<string | null>(null);
	let pendingUiStateWrite: (() => Promise<void>) | null = null;
	let uiStateWriteTimer: ReturnType<typeof setTimeout> | undefined;

	const scope = $derived(view ? `${view.profileId}:${view.householdId}` : null);
	const householdId = $derived(view?.householdId ?? null);
	const dashboardMeals = $derived.by((): Meal[] => {
		if (!view) return [];
		// The range and pool queries re-run independently, so a meal crossing between them can
		// briefly appear in both. The higher revision is the newer local write.
		const latest = new Map(
			[...rangeMeals.meals, ...poolMeals.meals]
				.toSorted((left, right) => left.revision - right.revision)
				.map((meal) => [meal.id, meal])
		);
		const latestCheckInByMeal = new Map(
			[...rangeMeals.checkIns, ...poolMeals.checkIns]
				.filter(({ mealId }) => mealId !== null)
				.toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt))
				.map((checkIn) => [checkIn.mealId!, checkIn])
		);
		const timeZone = view.householdTimeZone;
		return [...latest.values()].map((meal) =>
			mealAggregateToScheduleMeal(meal, latestCheckInByMeal.get(meal.id), timeZone)
		);
	});

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

	const planRecipe = async (recipe: RecipeMenuItem, date?: string): Promise<Meal> => {
		if (!database || !view) throw new Error('Local meal storage is still opening.');
		const planned = await planRecipeAsMeal(database, await commandContext(), recipe.id, {
			date: date ?? null,
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

	const reorderMealsInOneCommit = async (moves: { meal: Meal }[]): Promise<void> => {
		if (!database) throw new Error('Local meal storage is still opening.');
		const context = await commandContext();
		await reorderMeals(
			database,
			context,
			moves.map(({ meal }) => ({
				mealId: meal.id,
				patch: {
					date: meal.date ?? null,
					time: meal.time ?? null,
					sortOrder: meal.sortOrder ?? null,
					plannedCookUserId: meal.plannedCookWorkosUserId ?? null,
					plannedYield: meal.servingsPlanned ?? null
				}
			}))
		);
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
		const { meal } = await createRecipeAndPlanMeal(
			database,
			await commandContext(),
			recipeMenuItemToEditorPatch(recipe),
			{ date: date ?? null, sortOrder: null, plannedYield: view.defaultMealServings }
		);
		return mealAggregateToScheduleMeal(meal, undefined, view.householdTimeZone);
	};

	const importRecipeAndMeal = async (url: string, date?: string): Promise<Meal> => {
		if (!database || !view) throw new Error('Local recipe storage is still opening.');
		const candidate = await fetchRecipeUrlCandidate(database, url);
		const { meal } = await commitImportedCandidateAndPlanMeal(
			database,
			await commandContext(),
			candidate,
			{
				date: date ?? null,
				sortOrder: null,
				plannedYield: view.defaultMealServings
			}
		);
		return mealAggregateToScheduleMeal(meal, undefined, view.householdTimeZone);
	};

	const flushUiState = (): void => {
		clearTimeout(uiStateWriteTimer);
		uiStateWriteTimer = undefined;
		const write = pendingUiStateWrite;
		pendingUiStateWrite = null;
		write?.().catch(() => {
			error = 'Your schedule position could not be saved.';
		});
	};

	const saveUiState = (state: ScheduleUiState): void => {
		if (!database || !view) return;
		const opened = database;
		const { profileId, householdId } = view;
		pendingUiStateWrite = () => writeScheduleUiState(opened, profileId, householdId, state);
		uiStateWriteTimer ??= setTimeout(flushUiState, uiStateWriteIntervalMs);
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
					const [recipeAggregates, memberships, profiles] = await Promise.all([
						listRecipes(opened, profile.workosUserId),
						opened.memberships.where('householdId').equals(household.householdId).toArray(),
						opened.profiles.toArray()
					]);
					return {
						profileId: profile.profileId,
						userId: profile.workosUserId,
						householdId: household.householdId,
						defaultMealServings: household.defaultPlannedYield,
						weekStartsOn: household.weekStartsOn === 0 ? 'sunday' : 'monday',
						householdTimeZone: household.timezone ?? undefined,
						recipes: recipeAggregates.map(recipeAggregateToPickerItem),
						householdMembers: membershipsToHouseholdMembers(memberships, profiles)
					};
				}).subscribe({
					next: (nextView) => {
						const previousScope = view ? `${view.profileId}:${view.householdId}` : null;
						const nextScope = nextView ? `${nextView.profileId}:${nextView.householdId}` : null;
						if (previousScope !== nextScope) {
							rangeMeals = noMeals;
							renderedMealRange = null;
						}
						view = nextView;
						error = null;
					},
					error: () => {
						error = readError;
					}
				});
			})
			.catch(() => {
				error = 'Your local meal plan could not be opened.';
			});
		return () => {
			subscription?.unsubscribe();
			flushUiState();
		};
	});

	// The schedule owns its UI state after the first render, so it is read once per scope and
	// kept out of the live view query. Otherwise every scroll write would re-run that query.
	$effect(() => {
		const opened = database;
		const readScope = scope;
		if (!opened || !readScope) return;
		const { profileId, householdId, householdTimeZone } = untrack(() => view!);
		let current = true;
		readScheduleUiState(opened, profileId, householdId, householdTimeZone).then(
			(state) => {
				if (current) uiState = { scope: readScope, state };
			},
			() => {
				if (!current) return;
				error = readError;
				// Render the first-visit state anyway; the failed read may succeed next scope change.
				uiState = { scope: readScope, state: defaultScheduleUiState(householdTimeZone) };
			}
		);
		return () => {
			current = false;
			flushUiState();
		};
	});

	$effect(() => {
		const opened = database;
		if (!opened || !householdId) return;
		const subscription = liveMealPool(opened, householdId).subscribe({
			next: (result) => {
				poolMeals = result;
			},
			error: () => {
				error = readError;
			}
		});
		return () => {
			subscription.unsubscribe();
			poolMeals = noMeals;
		};
	});

	$effect(() => {
		const opened = database;
		const range = renderedMealRange;
		if (!opened || !householdId || !range) return;
		const subscription = liveMealCalendarRange(opened, householdId, range).subscribe({
			next: (result) => {
				rangeMeals = result;
			},
			error: () => {
				error = readError;
			}
		});
		return () => subscription.unsubscribe();
	});
</script>

<svelte:head><title>Meal plan · Maal</title></svelte:head>
<svelte:window onpagehide={flushUiState} />

{#if database}
	{#if view}
		{#if uiState?.scope === scope}
			{#key scope}
				<ScheduleDashboard
					meals={dashboardMeals}
					recipes={view.recipes}
					weekStartsOn={view.weekStartsOn}
					householdTimeZone={view.householdTimeZone}
					currentUserId={view.userId}
					householdMembers={view.householdMembers}
					initialUiState={uiState.state}
					{error}
					onplanrecipe={planRecipe}
					onmealchange={changeMeal}
					onmealsreorder={reorderMealsInOneCommit}
					onmealdelete={removeMeal}
					onmealcheckin={checkIn}
					oncreaterecipe={createRecipeAndMeal}
					onimporturl={importRecipeAndMeal}
					onloadedrangechange={updateRenderedMealRange}
					onuistatechange={saveUiState}
				/>
			{/key}
		{/if}
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

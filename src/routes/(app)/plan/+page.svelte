<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ScheduleDashboard from '$lib/components/dashboard/schedule-dashboard.svelte';
	import type { HouseholdMember, Meal } from '$lib/plan/plan-types';
	import { activeHouseholdId } from '$lib/stores/active-household';
	import { getCachedPlanRouteData, setCachedPlanRouteData } from '$lib/stores/route-data-cache';
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let meals = $state<Meal[]>(untrack(() => data.meals ?? []));
	let householdMembers = $state<HouseholdMember[]>(untrack(() => data.householdMembers ?? []));
	let cacheHydrationVersion = 0;
	let unsubscribeActiveHousehold: (() => void) | null = null;

	const cacheScope = (householdId: string | null | undefined = data.activeHouseholdId) => ({
		userId: data.session?.user.id,
		householdId
	});

	const hydrateCachedPlan = async (
		householdId: string | null | undefined,
		clearWhenMissing = false
	) => {
		const version = ++cacheHydrationVersion;
		const cached = await getCachedPlanRouteData(cacheScope(householdId));
		if (version !== cacheHydrationVersion || (!cached && !clearWhenMissing)) return;
		meals = cached?.meals ?? [];
		householdMembers = cached?.householdMembers ?? [];
	};

	$effect(() => {
		const routeMeals = data.meals ?? [];
		const routeHouseholdMembers = data.householdMembers ?? [];

		meals = routeMeals;
		householdMembers = routeHouseholdMembers;
		void setCachedPlanRouteData(cacheScope(), {
			meals: routeMeals,
			householdMembers: routeHouseholdMembers
		});
	});

	onMount(() => {
		void hydrateCachedPlan(data.activeHouseholdId);

		unsubscribeActiveHousehold = activeHouseholdId.subscribe((householdId) => {
			if (householdId && householdId !== data.activeHouseholdId)
				void hydrateCachedPlan(householdId, true);
			if (!householdId) {
				meals = [];
				householdMembers = [];
			}
		});
	});
	onDestroy(() => unsubscribeActiveHousehold?.());
</script>

<svelte:head>
	<title>{m.plan_meal_plan_maal()}</title>
</svelte:head>

<ScheduleDashboard
	{meals}
	recipes={data.recipes}
	defaultMealServings={data.defaultMealServings}
	weekStartsOn={data.weekStartsOn}
	initialMealRange={data.initialMealRange}
	currentUserId={data.session?.user.id}
	{householdMembers}
	unitPreferences={data.unitPreferences}
/>

<script lang="ts">
	import ScheduleDashboard from '$lib/components/dashboard/schedule-dashboard.svelte';
	import type { HouseholdMember, Meal } from '$lib/components/dashboard/schedule-types';
	import { activeHouseholdId } from '$lib/stores/active-household';
	import { getCachedPlanRouteData, setCachedPlanRouteData } from '$lib/stores/route-data-cache';
	import { onDestroy, onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let meals = $state<Meal[]>([]);
	let householdMembers = $state<HouseholdMember[]>([]);
	let unsubscribeActiveHousehold: (() => void) | null = null;

	$effect(() => {
		void Promise.all([Promise.resolve(data.meals), Promise.resolve(data.householdMembers)]).then(
			([resolvedMeals, resolvedMembers]) => {
				meals = resolvedMeals ?? [];
				householdMembers = resolvedMembers ?? [];
				setCachedPlanRouteData(data.activeHouseholdId, { meals, householdMembers });
			}
		);
	});

	onMount(() => {
		const cached = getCachedPlanRouteData(data.activeHouseholdId);
		if (cached) {
			meals = cached.meals;
			householdMembers = cached.householdMembers;
		}

		unsubscribeActiveHousehold = activeHouseholdId.subscribe((householdId) => {
			if (householdId && householdId !== data.activeHouseholdId) {
				const cached = getCachedPlanRouteData(householdId);
				meals = cached?.meals ?? [];
				householdMembers = cached?.householdMembers ?? [];
			}
		});
	});
	onDestroy(() => unsubscribeActiveHousehold?.());
</script>

<svelte:head>
	<title>Meal Plan · Maal</title>
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

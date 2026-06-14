<script lang="ts">
	import ScheduleDashboard from '$lib/components/dashboard/schedule-dashboard.svelte';
	import type { HouseholdMember, Meal } from '$lib/components/dashboard/schedule-types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let meals = $state<Meal[]>([]);
	let householdMembers = $state<HouseholdMember[]>([]);

	$effect(() => {
		void Promise.resolve(data.meals).then((resolvedMeals) => {
			meals = resolvedMeals;
		});
	});

	$effect(() => {
		void Promise.resolve(data.householdMembers).then((resolvedMembers) => {
			householdMembers = resolvedMembers;
		});
	});
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

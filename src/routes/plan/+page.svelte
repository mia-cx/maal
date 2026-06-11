<script lang="ts">
	import ScheduleDashboard from '$lib/components/dashboard/schedule-dashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Meal Plan · Maal</title>
</svelte:head>

<ScheduleDashboard
	meals={data.meals}
	recipes={data.recipes}
	defaultMealServings={data.defaultMealServings}
	weekStartsOn={data.weekStartsOn}
	initialMealRange={data.initialMealRange}
/>

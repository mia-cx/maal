<script lang="ts">
	import HouseholdOnboarding from '$lib/components/household/household-onboarding.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Set up household · Maal</title>
</svelte:head>

<HouseholdOnboarding
	defaultHouseholdName={data.defaultHouseholdName}
	canStartTrial={data.canStartTrial}
	hasHouseholds={data.hasHouseholds}
/>

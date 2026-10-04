<script lang="ts">
	import MealPlanCard from './meal-plan-card.svelte';
	import type { Meal } from './schedule-types';

	let { meal, x, y }: { meal: Meal | null; x: number; y: number } = $props();
</script>

{#if meal}
	<div
		class="pointer-events-none fixed z-[80] w-56 -translate-x-1/2 -translate-y-1/2 opacity-75 drop-shadow-lg"
		style:left={`${x}px`}
		style:top={`${y}px`}
	>
		<MealPlanCard {meal} density="summary" />
	</div>
{/if}

<script lang="ts">
	import { cn } from '$lib/utils.js';
	import MealPlanCard from './meal-plan-card.svelte';
	import type { Meal, MealCardDensity, MealPickHandler, MealSelectHandler } from './schedule-types';

	let {
		meal,
		compact = false,
		density,
		hidden = false,
		showImage = false,
		imageLayout = 'side',
		onpick,
		onselect,
		class: className
	}: {
		meal: Meal;
		compact?: boolean;
		density?: MealCardDensity;
		hidden?: boolean;
		showImage?: boolean;
		imageLayout?: 'side' | 'side-compact' | 'top' | 'adaptive';
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
		class?: string;
	} = $props();

	const cardDensity = $derived(density ?? (compact ? 'title' : 'summary'));
</script>

<MealPlanCard
	{meal}
	density={cardDensity}
	{hidden}
	{showImage}
	{imageLayout}
	{onpick}
	{onselect}
	class={cn('min-h-0 w-full', className)}
/>

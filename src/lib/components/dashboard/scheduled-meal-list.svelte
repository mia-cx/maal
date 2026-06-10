<script lang="ts">
	import EmptyScheduleSlot from './empty-schedule-slot.svelte';
	import MealDropSkeleton from './meal-drop-skeleton.svelte';
	import PlannedMeal from './planned-meal.svelte';
	import type { Meal, MealCardDensity, MealPickHandler, MealSelectHandler } from './schedule-types';

	let {
		meals,
		previewIndex = -1,
		draggingMealId,
		draggedMeal,
		density = 'summary',
		compact = false,
		showEmpty = true,
		showImages = false,
		imageLayout = 'side',
		cardClass,
		onpick,
		onselect
	}: {
		meals: Meal[];
		previewIndex?: number;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		density?: MealCardDensity;
		compact?: boolean;
		showEmpty?: boolean;
		showImages?: boolean;
		imageLayout?: 'side' | 'side-compact' | 'top' | 'adaptive';
		cardClass?: string;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
	} = $props();
</script>

{#each meals as meal, index (meal.id)}
	{#if previewIndex === index}
		<MealDropSkeleton meal={draggedMeal} {density} {showImages} {imageLayout} />
	{/if}
	<PlannedMeal
		{meal}
		{density}
		{compact}
		showImage={showImages}
		{imageLayout}
		hidden={previewIndex < 0 && meal.id === draggingMealId}
		{onpick}
		{onselect}
		class={cardClass}
	/>
{/each}
{#if previewIndex >= meals.length}
	<MealDropSkeleton meal={draggedMeal} {density} {showImages} {imageLayout} />
{:else if showEmpty && meals.length === 0}
	<div class="min-h-8">
		<EmptyScheduleSlot />
	</div>
{/if}

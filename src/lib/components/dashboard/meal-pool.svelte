<script lang="ts">
	import { cn } from '$lib/utils.js';
	import MealDropSkeleton from './meal-drop-skeleton.svelte';
	import MealPlanCard from './meal-plan-card.svelte';
	import type {
		Meal,
		MealCardDensity,
		MealDropTarget,
		MealPickHandler,
		MealSelectHandler
	} from './schedule-types';

	let {
		meals,
		density = 'summary',
		showImages = false,
		cardClass,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onpick,
		onselect
	}: {
		meals: Meal[];
		density?: MealCardDensity;
		showImages?: boolean;
		cardClass?: string;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
	} = $props();

	const cardDensity = $derived(showImages && density === 'title' ? 'summary' : density);
	const cardWidthClass = $derived(
		showImages ? 'w-56 shrink-0' : cardDensity === 'title' ? 'w-44 shrink-0' : 'w-48 shrink-0'
	);
	const previewIndex = $derived(dropTarget?.kind === 'pool' ? dropTarget.index : -1);
	const previewMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
</script>

<section class="min-w-0 overflow-hidden">
	<div
		data-drag-secondary-scroll
		data-meal-drop-kind="pool"
		class="flex min-w-0 gap-1 overflow-x-auto px-1 py-1"
	>
		{#each previewMeals as meal, index (meal.id)}
			{#if previewIndex === index}
				<MealDropSkeleton
					meal={draggedMeal}
					density={cardDensity}
					{showImages}
					imageLayout="side"
					imageAspect="portrait"
					class={cardWidthClass}
				/>
			{/if}
			<MealPlanCard
				{meal}
				density={cardDensity}
				showImage={showImages}
				imageLayout="side"
				imageAspect="portrait"
				hidden={previewIndex < 0 && meal.id === draggingMealId}
				{onpick}
				{onselect}
				class={cn('min-h-0', cardWidthClass, cardClass)}
			/>
		{/each}
		{#if previewIndex >= previewMeals.length}
			<MealDropSkeleton
				meal={draggedMeal}
				density={cardDensity}
				{showImages}
				imageLayout="side"
				imageAspect="portrait"
				class={cardWidthClass}
			/>
		{/if}
	</div>
</section>

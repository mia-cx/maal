<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { cn } from '$lib/utils.js';
	import MealDropSkeleton from './meal-drop-skeleton.svelte';
	import MealPlanCard from './meal-plan-card.svelte';
	import type {
		Meal,
		MealAddHandler,
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
		onaddmeal,
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
		onaddmeal?: MealAddHandler;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
	} = $props();

	const cardDensity = $derived(showImages && density === 'title' ? 'summary' : density);
	const cardWidthClass = $derived(
		showImages ? 'w-56 shrink-0' : cardDensity === 'title' ? 'w-44 shrink-0' : 'w-48 shrink-0'
	);
	const poolHeightClass = $derived(showImages ? 'h-20' : cardDensity === 'title' ? 'h-10' : 'h-14');
	let poolHeight = $state(0);

	const fallbackAddButtonSize = $derived(cardDensity === 'title' ? 32 : 48);
	const addButtonSize = $derived(Math.max(fallbackAddButtonSize, poolHeight - 8));
	const previewIndex = $derived(dropTarget?.kind === 'pool' ? dropTarget.index : -1);
	const previewMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
</script>

<section class="min-w-0 overflow-hidden">
	<div
		bind:clientHeight={poolHeight}
		data-drag-secondary-scroll
		data-meal-drop-kind="pool"
		class={cn('flex min-w-0 items-start gap-1 overflow-x-auto px-1 py-1', poolHeightClass)}
	>
		<button
			type="button"
			aria-label={m.plan_add_meal()}
			class="flex shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-1 text-[0.625rem] leading-none font-medium text-muted-foreground transition hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
			style:width={`${addButtonSize}px`}
			style:height={`${addButtonSize}px`}
			onclick={() => onaddmeal?.()}
		>
			<span class="text-lg leading-none">+</span>
			<span class={cardDensity === 'title' ? 'sr-only' : ''}>{m.plan_meal()}</span>
		</button>
		{#each previewMeals as meal, index (meal.id)}
			{#if previewIndex === index}
				<MealDropSkeleton
					meal={draggedMeal}
					density={cardDensity}
					{showImages}
					imageLayout="side-compact"
					imageAspect="landscape"
					class={cn('h-full', cardWidthClass)}
				/>
			{/if}
			<MealPlanCard
				{meal}
				density={cardDensity}
				showImage={showImages}
				imageLayout="side-compact"
				imageAspect="landscape"
				hidden={previewIndex < 0 && meal.id === draggingMealId}
				{onpick}
				{onselect}
				class={cn('h-full min-h-0', cardWidthClass, cardClass)}
			/>
		{/each}
		{#if previewIndex >= previewMeals.length}
			<MealDropSkeleton
				meal={draggedMeal}
				density={cardDensity}
				{showImages}
				imageLayout="side-compact"
				imageAspect="landscape"
				class={cn('h-full', cardWidthClass)}
			/>
		{/if}
	</div>
</section>

<script lang="ts">
	import { dateKey, formatDayHeading, isToday } from './schedule-date';
	import ScheduledMealList from './scheduled-meal-list.svelte';
	import type { Meal, MealDropTarget, MealPickHandler, MealSelectHandler } from './schedule-types';

	let {
		day,
		meals,
		mealPoolOffset,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onpick,
		onselect
	}: {
		day: Date;
		meals: Meal[];
		mealPoolOffset: number;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
	} = $props();

	const dayKey = $derived(dateKey(day));
	const previewIndex = $derived(
		dropTarget?.kind === 'date' && dropTarget.date === dayKey ? dropTarget.index : -1
	);
	const previewMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
</script>

<section
	class="border-b border-border"
	data-day-key={dayKey}
	data-meal-drop-kind="date"
	data-meal-drop-date={dayKey}
	data-today={isToday(day) ? 'daily' : undefined}
>
	<div
		data-daily-date
		class="sticky z-20 border-b border-border bg-background/95 px-4 py-1 text-xs font-medium backdrop-blur"
		style:top="{mealPoolOffset}px"
	>
		<span
			class={isToday(day)
				? '-ml-2 rounded-sm bg-primary px-2 py-0.5 text-primary-foreground'
				: undefined}
		>
			{formatDayHeading(day)}
		</span>
	</div>
	<div class="space-y-1 px-1 py-1">
		<ScheduledMealList
			meals={previewMeals}
			{previewIndex}
			{draggingMealId}
			{draggedMeal}
			density="detail"
			showImages
			{onpick}
			{onselect}
		/>
	</div>
</section>

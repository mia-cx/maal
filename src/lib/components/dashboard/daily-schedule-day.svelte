<script lang="ts">
	import { dateKey, formatDayHeading, isToday } from './schedule-date';
	import ScheduledMealList from './scheduled-meal-list.svelte';
	import type {
		Meal,
		MealAddHandler,
		MealDropTarget,
		MealCheckInHandler,
		MealPickHandler,
		MealSelectHandler
	} from './schedule-types';

	let {
		day,
		meals,
		mealPoolOffset,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onaddmeal,
		onpick,
		onselect,
		oncheckin
	}: {
		day: Date;
		meals: Meal[];
		mealPoolOffset: number;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onaddmeal?: MealAddHandler;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
		oncheckin?: MealCheckInHandler;
	} = $props();

	const dayKey = $derived(dateKey(day));
	const previewIndex = $derived(
		dropTarget?.kind === 'date' && dropTarget.date === dayKey ? dropTarget.index : -1
	);
	const previewMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);

	const addMealOnBlankTarget = (event: MouseEvent) => {
		if (
			event.target instanceof Element &&
			event.target.closest(
				'button, a, input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-meal-card-id]'
			)
		)
			return;
		event.stopPropagation();
		onaddmeal?.(dayKey);
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
	class="border-b border-border"
	data-day-key={dayKey}
	data-meal-drop-kind="date"
	data-meal-drop-date={dayKey}
	data-today={isToday(day) ? 'daily' : undefined}
	ondblclick={addMealOnBlankTarget}
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
	<div role="button" tabindex="-1" aria-label={`Add meal on ${dayKey}`} class="space-y-1 px-1 py-1">
		<ScheduledMealList
			meals={previewMeals}
			{previewIndex}
			{draggingMealId}
			{draggedMeal}
			date={dayKey}
			{onaddmeal}
			density="detail"
			showImages
			{onpick}
			{onselect}
			{oncheckin}
		/>
	</div>
</section>

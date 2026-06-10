<script lang="ts">
	import { dateKey, isToday } from './schedule-date';
	import ScheduledMealList from './scheduled-meal-list.svelte';
	import type { Meal, MealDropTarget, MealPickHandler, MealSelectHandler } from './schedule-types';

	let {
		day,
		index,
		meals,
		draggingScroller = false,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onpick,
		onselect
	}: {
		day: Date;
		index: number;
		meals: Meal[];
		draggingScroller?: boolean;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
	} = $props();

	let columnHeight = $state(0);

	const multiDayTopImageMinHeight = 672;
	const dayKey = $derived(dateKey(day));
	const shortDayName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date);
	const previewIndex = $derived(
		dropTarget?.kind === 'date' && dropTarget.date === dayKey ? dropTarget.index : -1
	);
	const previewMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
	const imageLayout = $derived(columnHeight >= multiDayTopImageMinHeight ? 'top' : 'side-compact');
</script>

<section
	bind:clientHeight={columnHeight}
	data-day-key={dayKey}
	data-meal-drop-kind="date"
	data-meal-drop-date={dayKey}
	class="min-h-full min-w-0 border-border"
	class:border-l={index > 0}
>
	<div
		class="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-1 text-xs font-medium backdrop-blur"
		class:cursor-grab={!draggingScroller}
		class:cursor-grabbing={draggingScroller}
	>
		<span
			class={isToday(day)
				? '-ml-2 inline-flex h-5 items-center rounded-sm bg-primary px-2 text-primary-foreground'
				: 'inline-flex h-5 items-center'}
		>
			{shortDayName(day)}
			<span class:text-muted-foreground={!isToday(day)} class="ml-1">{day.getDate()}</span>
		</span>
	</div>
	<div class="space-y-1 p-1">
		<ScheduledMealList
			meals={previewMeals}
			{previewIndex}
			{draggingMealId}
			{draggedMeal}
			showImages
			{imageLayout}
			{onpick}
			{onselect}
		/>
	</div>
</section>

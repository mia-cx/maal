<script lang="ts">
	import { dateKey, isToday } from './schedule-date';
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
		index,
		meals,
		draggingScroller = false,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onaddmeal,
		onpick,
		onselect,
		oncheckin
	}: {
		day: Date;
		index: number;
		meals: Meal[];
		draggingScroller?: boolean;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onaddmeal?: MealAddHandler;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
		oncheckin?: MealCheckInHandler;
	} = $props();

	let columnHeight = $state(0);

	const multiDayTopImageMinHeight = 672;
	const dayKey = $derived(dateKey(day));
	const shortDayName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date);
	const shortMonthName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { month: 'short' }).format(date);
	const dayNumberLabel = $derived(`${day.getDate()} ${shortMonthName(day)}`);
	const previewIndex = $derived(
		dropTarget?.kind === 'date' && dropTarget.date === dayKey ? dropTarget.index : -1
	);
	const previewMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
	const imageLayout = $derived(columnHeight >= multiDayTopImageMinHeight ? 'top' : 'side-compact');

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
	bind:clientHeight={columnHeight}
	data-day-key={dayKey}
	data-meal-drop-kind="date"
	data-meal-drop-date={dayKey}
	class="flex min-h-full min-w-0 flex-col border-border"
	class:border-l={index > 0}
	ondblclick={addMealOnBlankTarget}
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
			<span class:text-muted-foreground={!isToday(day)} class="ml-1">{dayNumberLabel}</span>
		</span>
	</div>
	<div
		role="button"
		tabindex="-1"
		aria-label={`Add meal on ${dayKey}`}
		class="min-h-0 flex-1 space-y-1 p-1"
	>
		<ScheduledMealList
			meals={previewMeals}
			{previewIndex}
			{draggingMealId}
			{draggedMeal}
			date={dayKey}
			{onaddmeal}
			showImages
			{imageLayout}
			{onpick}
			{onselect}
			{oncheckin}
		/>
	</div>
</section>

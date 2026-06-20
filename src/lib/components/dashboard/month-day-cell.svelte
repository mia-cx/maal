<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { cn } from '$lib/utils.js';
	import { dateKey, isSameMonth, isToday } from './schedule-date';
	import { handleBlankScheduleTarget } from './schedule-interactions';
	import ScheduledMealList from './scheduled-meal-list.svelte';
	import type {
		Meal,
		MealAddHandler,
		MealCheckInHandler,
		MealDropTarget,
		MealPickHandler,
		MealSelectHandler
	} from './schedule-types';

	let {
		day,
		index,
		anchorDate,
		meals,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onaddmeal,
		onpick,
		onselect,
		oncheckin,
		onselectdate
	}: {
		day: Date;
		index: number;
		anchorDate: Date;
		meals: Meal[];
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onaddmeal?: MealAddHandler;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
		oncheckin?: MealCheckInHandler;
		onselectdate?: (date: Date) => void;
	} = $props();

	const compactMealRowHeight = 28;
	const overflowRowHeight = 20;
	let contentHeight = $state(0);

	const dayKey = $derived(dateKey(day));
	const isInMonth = $derived(isSameMonth(day, anchorDate));
	const previewIndex = $derived(
		dropTarget?.kind === 'date' && dropTarget.date === dayKey ? dropTarget.index : -1
	);
	const previewSourceMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
	const visibleMealCount = $derived(
		Math.max(0, Math.floor((contentHeight - overflowRowHeight) / compactMealRowHeight))
	);
	const monthVisibleMeals = $derived(previewSourceMeals.slice(0, visibleMealCount));
	const overflowCount = $derived(Math.max(0, previewSourceMeals.length - visibleMealCount));
	const overflowLabel = $derived(
		visibleMealCount === 0 ? `${overflowCount} meals` : `+${overflowCount} more`
	);
	const outlineDropCell = $derived(previewIndex >= 0 && overflowCount > 0);
	const visiblePreviewIndex = $derived(outlineDropCell ? -1 : previewIndex);
	const addMealOnBlankTarget = (event: MouseEvent) =>
		handleBlankScheduleTarget(event, dayKey, onaddmeal);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
	data-meal-drop-kind="date"
	data-meal-drop-date={dayKey}
	class={cn(
		'flex min-h-0 min-w-0 flex-col overflow-hidden border-border p-1',
		outlineDropCell && 'bg-primary/5 ring-2 ring-primary/60 ring-inset'
	)}
	class:border-l={index % 7 !== 0}
	class:border-b={true}
	ondblclick={addMealOnBlankTarget}
>
	<button
		type="button"
		class:text-muted-foreground={!isInMonth}
		class="mb-0.5 ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
		class:bg-primary={isToday(day)}
		class:text-primary-foreground={isToday(day)}
		onclick={() => onselectdate?.(day)}
		aria-label={m.app_open_date_day_view({ date: dayKey })}
	>
		{day.getDate()}
	</button>

	<div
		bind:clientHeight={contentHeight}
		role="button"
		tabindex="-1"
		aria-label={m.app_add_meal_on_date({ date: dayKey })}
		class="min-h-0 flex-1 space-y-1 overflow-hidden"
	>
		<ScheduledMealList
			meals={monthVisibleMeals}
			previewIndex={visiblePreviewIndex}
			{draggingMealId}
			{draggedMeal}
			date={dayKey}
			{onaddmeal}
			compact
			density="title"
			showEmpty={false}
			{onpick}
			{onselect}
			{oncheckin}
		/>
		{#if overflowCount > 0}
			<button
				type="button"
				class="h-5 w-full truncate pl-2.5 text-left text-xs leading-none font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
				onclick={() => onselectdate?.(day)}
			>
				{overflowLabel}
			</button>
		{/if}
	</div>
</section>

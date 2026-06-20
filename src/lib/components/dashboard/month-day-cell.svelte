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

	const maxMonthVisibleMeals = 6;
	const visibleMealCounts = Array.from({ length: maxMonthVisibleMeals + 1 }, (_, count) => count);

	const dayKey = $derived(dateKey(day));
	const isInMonth = $derived(isSameMonth(day, anchorDate));
	const previewIndex = $derived(
		dropTarget?.kind === 'date' && dropTarget.date === dayKey ? dropTarget.index : -1
	);
	const previewSourceMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
	const monthVisibleMeals = $derived(previewSourceMeals.slice(0, maxMonthVisibleMeals));
	const hasOverflow = $derived(previewSourceMeals.length > 1);
	const outlineDropCell = $derived(previewIndex >= 0 && hasOverflow);
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
		role="button"
		tabindex="-1"
		aria-label={m.app_add_meal_on_date({ date: dayKey })}
		class="min-h-0 flex-1 space-y-1 overflow-hidden"
	>
		<div class="month-meal-list">
			<ScheduledMealList
				meals={monthVisibleMeals}
				{previewIndex}
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
		</div>
		{#each visibleMealCounts as visibleCount (visibleCount)}
			{@const overflowCount = Math.max(0, previewSourceMeals.length - visibleCount)}
			{#if overflowCount > 0}
				<button
					type="button"
					class="month-overflow-label h-5 w-full truncate pl-2.5 text-left text-xs leading-none font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
					data-visible-count={visibleCount}
					onclick={() => onselectdate?.(day)}
				>
					{visibleCount === 0 ? `${overflowCount} meals` : `+${overflowCount} more`}
				</button>
			{/if}
		{/each}
	</div>
</section>

<style>
	section {
		container: month-day-cell / size;
	}

	.month-meal-list :global(> :nth-child(n + 2)),
	.month-overflow-label {
		display: none;
	}

	.month-overflow-label[data-visible-count='1'] {
		display: block;
	}

	@container month-day-cell (height < 72px) {
		.month-meal-list :global(> :nth-child(n + 1)) {
			display: none;
		}

		.month-overflow-label[data-visible-count='1'] {
			display: none;
		}

		.month-overflow-label[data-visible-count='0'] {
			display: block;
		}
	}

	@container month-day-cell (height >= 112px) {
		.month-meal-list :global(> :nth-child(-n + 2)) {
			display: block;
		}

		.month-overflow-label[data-visible-count='1'] {
			display: none;
		}

		.month-overflow-label[data-visible-count='2'] {
			display: block;
		}
	}

	@container month-day-cell (height >= 144px) {
		.month-meal-list :global(> :nth-child(-n + 3)) {
			display: block;
		}

		.month-overflow-label[data-visible-count='2'] {
			display: none;
		}

		.month-overflow-label[data-visible-count='3'] {
			display: block;
		}
	}

	@container month-day-cell (height >= 176px) {
		.month-meal-list :global(> :nth-child(-n + 4)) {
			display: block;
		}

		.month-overflow-label[data-visible-count='3'] {
			display: none;
		}

		.month-overflow-label[data-visible-count='4'] {
			display: block;
		}
	}

	@container month-day-cell (height >= 208px) {
		.month-meal-list :global(> :nth-child(-n + 5)) {
			display: block;
		}

		.month-overflow-label[data-visible-count='4'] {
			display: none;
		}

		.month-overflow-label[data-visible-count='5'] {
			display: block;
		}
	}

	@container month-day-cell (height >= 240px) {
		.month-meal-list :global(> :nth-child(-n + 6)) {
			display: block;
		}

		.month-overflow-label[data-visible-count='5'] {
			display: none;
		}

		.month-overflow-label[data-visible-count='6'] {
			display: block;
		}
	}
</style>

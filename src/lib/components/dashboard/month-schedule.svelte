<script lang="ts">
	import MealPool from './meal-pool.svelte';
	import MonthDayCell from './month-day-cell.svelte';
	import { dateKey, formatMonthHeading, isSameMonth, monthGridDays } from './schedule-date';
	import { sortScheduledMeals } from './schedule-ordering';
	import type { Meal, MealDropTarget } from './schedule-types';
	import { scheduleDays } from './schedule-types';

	let {
		mealPool,
		plannedMeals,
		showMealPoolImages = false,
		anchorDate,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onpick,
		onselect,
		onselectdate
	}: {
		mealPool: Meal[];
		plannedMeals: Meal[];
		showMealPoolImages?: boolean;
		anchorDate: Date;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onpick?: (meal: Meal, event: PointerEvent) => void;
		onselect?: (meal: Meal) => void;
		onselectdate?: (date: Date) => void;
	} = $props();

	const days = $derived(monthGridDays(anchorDate));
	const dayName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);
	const mealsForDate = (date: Date): Meal[] => {
		const key = dateKey(date);
		return sortScheduledMeals(
			plannedMeals.filter((meal) => meal.date === key || (!meal.date && meal.day === dayName(date)))
		);
	};
</script>

<div class="flex h-full min-w-0 flex-col overflow-hidden">
	<div class="border-b border-border">
		<MealPool
			{draggingMealId}
			{draggedMeal}
			{dropTarget}
			{onpick}
			{onselect}
			meals={mealPool}
			density="title"
			showImages={showMealPoolImages}
		/>
	</div>
	<div class="border-b border-border px-4 py-1 text-xs font-medium">
		{formatMonthHeading(anchorDate)}
	</div>
	<div class="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-border">
		{#each scheduleDays as day, index (day)}
			<div
				class="min-w-0 border-border px-4 py-1 text-xs font-medium text-muted-foreground"
				class:border-l={index > 0}
			>
				<span class="inline-flex h-5 items-center">{day}</span>
			</div>
		{/each}
	</div>
	<div
		class="grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(0,1fr))] grid-rows-[repeat(6,minmax(0,1fr))] overflow-hidden"
	>
		{#each days as day, index (day.toISOString())}
			<MonthDayCell
				{day}
				{index}
				{anchorDate}
				meals={isSameMonth(day, anchorDate) ? mealsForDate(day) : []}
				{draggingMealId}
				{draggedMeal}
				{dropTarget}
				{onpick}
				{onselect}
				{onselectdate}
			/>
		{/each}
	</div>
</div>

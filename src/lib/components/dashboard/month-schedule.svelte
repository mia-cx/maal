<script lang="ts">
	import FloatingMeals from './floating-meals.svelte';
	import { formatMonthHeading, isSameMonth, isToday, monthGridDays } from './schedule-date';
	import PlannedMeal from './planned-meal.svelte';
	import type { Meal } from './schedule-types';
	import { scheduleDays } from './schedule-types';

	let {
		floatingMeals,
		plannedMeals,
		anchorDate
	}: { floatingMeals: Meal[]; plannedMeals: Meal[]; anchorDate: Date } = $props();

	const days = $derived(monthGridDays(anchorDate));
</script>

<div class="flex h-full min-w-0 flex-col overflow-hidden">
	<div class="border-b border-border px-4 py-2 text-sm font-medium">
		{formatMonthHeading(anchorDate)}
	</div>
	<div class="border-b border-border">
		<FloatingMeals meals={floatingMeals} />
	</div>
	<div class="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-border">
		{#each scheduleDays as day (day)}
			<div class="min-w-0 px-2 py-2 text-sm font-medium text-muted-foreground">{day}</div>
		{/each}
	</div>
	<div class="grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(0,1fr))] border-l border-border">
		{#each days as day (day.toISOString())}
			<section class="min-h-0 min-w-0 border-r border-b border-border p-2">
				<div
					class:text-muted-foreground={!isSameMonth(day, anchorDate)}
					class="mb-2 flex size-7 items-center justify-center rounded-sm text-sm font-medium"
					class:bg-primary={isToday(day)}
					class:text-primary-foreground={isToday(day)}
				>
					{day.getDate()}
				</div>
				{#if day.getDate() === 2 && plannedMeals[0] && isSameMonth(day, anchorDate)}
					<PlannedMeal meal={plannedMeals[0]} compact />
				{:else if day.getDate() === 4 && plannedMeals[1] && isSameMonth(day, anchorDate)}
					<PlannedMeal meal={plannedMeals[1]} compact />
				{:else if day.getDate() === 6 && plannedMeals[2] && isSameMonth(day, anchorDate)}
					<PlannedMeal meal={plannedMeals[2]} compact />
				{/if}
			</section>
		{/each}
	</div>
</div>

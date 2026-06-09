<script lang="ts">
	import { addDays, isoWeekNumber, isToday, startOfWeek } from './schedule-date';
	import EmptyScheduleSlot from './empty-schedule-slot.svelte';
	import FloatingMeals from './floating-meals.svelte';
	import PlannedMeal from './planned-meal.svelte';
	import type { Meal } from './schedule-types';
	import { scheduleDays } from './schedule-types';

	let {
		floatingMeals,
		plannedMeals,
		anchorDate
	}: { floatingMeals: Meal[]; plannedMeals: Meal[]; anchorDate: Date } = $props();

	const weekStart = $derived(startOfWeek(anchorDate));
	const weekDays = $derived(Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)));
	const mealsForDay = (day: string): Meal[] =>
		plannedMeals.filter((meal) => meal.day.startsWith(day));
</script>

<div class="flex h-full min-w-0 flex-col overflow-hidden">
	<div class="border-b border-border px-4 py-2 text-sm font-medium">
		Week {isoWeekNumber(anchorDate)}, {weekStart.getFullYear()}
	</div>
	<div class="border-b border-border">
		<FloatingMeals meals={floatingMeals} />
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(0,1fr))] border-l border-border">
		{#each scheduleDays as day, index (day)}
			<section class="min-w-0 border-r border-border">
				<div class="border-b border-border px-2 py-2 text-sm font-medium">
					<span
						class="inline-flex h-7 items-center rounded-sm px-2"
						class:bg-primary={isToday(weekDays[index])}
						class:text-primary-foreground={isToday(weekDays[index])}
					>
						{day}
						<span class:text-muted-foreground={!isToday(weekDays[index])} class="ml-1"
							>{weekDays[index].getDate()}</span
						>
					</span>
				</div>
				<div class="space-y-3 p-2">
					{#each mealsForDay(day) as meal (meal.id)}
						<PlannedMeal {meal} />
					{:else}
						<div class="min-h-8">
							<EmptyScheduleSlot />
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>

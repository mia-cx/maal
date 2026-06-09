<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import ContinuousSchedule from './continuous-schedule.svelte';
	import MonthSchedule from './month-schedule.svelte';
	import { addDays, addMonths, startOfDay } from './schedule-date';
	import { scheduleMeals } from './schedule-fixtures';
	import type { ScheduleMode } from './schedule-types';
	import WeekSchedule from './week-schedule.svelte';

	let mode = $state<ScheduleMode>('weekly');
	let anchorDate = $state(startOfDay(new Date()));
	let todaySignal = $state(0);

	const floatingMeals = $derived(scheduleMeals.filter((meal) => meal.status === 'floating'));
	const plannedMeals = $derived(scheduleMeals.filter((meal) => meal.status === 'planned'));
	const showDateControls = $derived(mode === 'daily' || mode === 'weekly' || mode === 'monthly');
	const showStepControls = $derived(mode === 'weekly' || mode === 'monthly');

	const previous = () => {
		anchorDate = mode === 'weekly' ? addDays(anchorDate, -7) : addMonths(anchorDate, -1);
	};

	const next = () => {
		anchorDate = mode === 'weekly' ? addDays(anchorDate, 7) : addMonths(anchorDate, 1);
	};

	const today = () => {
		anchorDate = startOfDay(new Date());
		todaySignal += 1;
	};
</script>

<section class="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
	<header
		class="sticky top-0 z-40 flex h-[52px] shrink-0 items-center border-b border-border bg-background px-2"
	>
		<div class="flex w-9 shrink-0 items-center justify-center">
			<Sidebar.Trigger />
		</div>
		<ButtonGroup.Root
			aria-label="Schedule view"
			class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
		>
			<Button
				variant={mode === 'daily' ? 'default' : 'outline'}
				size="sm"
				onclick={() => (mode = 'daily')}
			>
				Day
			</Button>
			<Button
				variant={mode === 'weekly' ? 'default' : 'outline'}
				size="sm"
				onclick={() => (mode = 'weekly')}
			>
				Week
			</Button>
			<Button
				variant={mode === 'monthly' ? 'default' : 'outline'}
				size="sm"
				onclick={() => (mode = 'monthly')}
			>
				Month
			</Button>
		</ButtonGroup.Root>

		<div class="ml-auto flex min-w-0 justify-end">
			{#if showDateControls}
				<div class="flex items-center gap-2">
					{#if showStepControls}
						<Button variant="outline" size="icon-sm" onclick={previous} aria-label="Previous"
							>‹</Button
						>
					{/if}
					<Button variant="outline" size="sm" onclick={today}>Today</Button>
					{#if showStepControls}
						<Button variant="outline" size="icon-sm" onclick={next} aria-label="Next">›</Button>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
		{#if mode === 'daily'}
			<ContinuousSchedule {floatingMeals} {plannedMeals} startDate={anchorDate} {todaySignal} />
		{:else if mode === 'weekly'}
			<WeekSchedule {floatingMeals} {plannedMeals} {anchorDate} />
		{:else}
			<MonthSchedule {floatingMeals} {plannedMeals} {anchorDate} />
		{/if}
	</div>
</section>

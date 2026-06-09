<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import { addDays, dailyScrollDays, formatDayHeading, isToday } from './schedule-date';
	import EmptyScheduleSlot from './empty-schedule-slot.svelte';
	import FloatingMeals from './floating-meals.svelte';
	import PlannedMeal from './planned-meal.svelte';
	import type { Meal } from './schedule-types';

	const edgeThreshold = 480;
	const pageSize = 21;

	let {
		floatingMeals,
		plannedMeals,
		startDate,
		todaySignal = 0
	}: {
		floatingMeals: Meal[];
		plannedMeals: Meal[];
		startDate: Date;
		todaySignal?: number;
	} = $props();

	let days = $state<Date[]>([]);
	let scroller: HTMLDivElement;
	let floatingMealsElement: HTMLDivElement;
	let floatingMealsOffset = $state(0);
	let mounted = false;
	let loadingMoreDays = false;
	let lastStartTime = $state(0);

	const measureFloatingMealsOffset = () => {
		if (!scroller || !floatingMealsElement) return;
		floatingMealsOffset =
			floatingMealsElement.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
	};

	const dayName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);
	const mealsForDate = (date: Date): Meal[] =>
		plannedMeals.filter((meal) => meal.day === dayName(date));

	const scrollToToday = async (behavior: ScrollBehavior = 'auto') => {
		if (!browser || !scroller || !floatingMealsElement) return;
		await tick();
		measureFloatingMealsOffset();
		const todayHeader = scroller.querySelector<HTMLElement>(
			'[data-today="daily"] [data-daily-date]'
		);
		if (!todayHeader) return;
		const targetTop =
			scroller.scrollTop +
			todayHeader.getBoundingClientRect().top -
			floatingMealsElement.getBoundingClientRect().bottom;
		scroller.scrollTo({ top: Math.max(0, targetTop), behavior });
	};

	const prependDays = async () => {
		if (!scroller || loadingMoreDays) return;
		loadingMoreDays = true;
		const previousHeight = scroller.scrollHeight;
		const firstDay = days[0];
		days = [
			...Array.from({ length: pageSize }, (_, index) => addDays(firstDay, index - pageSize)),
			...days
		];
		await tick();
		scroller.scrollTop += scroller.scrollHeight - previousHeight;
		loadingMoreDays = false;
	};

	const appendDays = async () => {
		if (loadingMoreDays) return;
		loadingMoreDays = true;
		const lastDay = days.at(-1)!;
		days = [
			...days,
			...Array.from({ length: pageSize }, (_, index) => addDays(lastDay, index + 1))
		];
		await tick();
		loadingMoreDays = false;
	};

	const loadMoreDays = () => {
		if (!scroller) return;
		if (scroller.scrollTop < edgeThreshold) void prependDays();
		const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
		if (remaining < edgeThreshold) void appendDays();
	};

	onMount(() => {
		mounted = true;
		measureFloatingMealsOffset();
		const resizeObserver = new ResizeObserver(measureFloatingMealsOffset);
		resizeObserver.observe(floatingMealsElement);
		void scrollToToday('auto');

		return () => resizeObserver.disconnect();
	});

	$effect(() => {
		const nextStartTime = startDate.getTime();
		if (nextStartTime === lastStartTime && days.length > 0) return;
		lastStartTime = nextStartTime;
		days = dailyScrollDays(startDate);
		void scrollToToday('auto');
	});

	$effect(() => {
		const signal = todaySignal;
		if (signal >= 0 && mounted) void scrollToToday('smooth');
	});
</script>

<div
	bind:this={scroller}
	data-daily-scroller
	onscroll={loadMoreDays}
	class="h-full min-w-0 [scrollbar-width:none] overflow-x-hidden overflow-y-auto [&::-webkit-scrollbar]:hidden"
>
	<div
		bind:this={floatingMealsElement}
		class="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur"
	>
		<FloatingMeals meals={floatingMeals} />
	</div>

	{#each days as day (day.toISOString())}
		<section class="border-b border-border" data-today={isToday(day) ? 'daily' : undefined}>
			<div
				data-daily-date
				class="sticky z-20 border-b border-border bg-background/95 px-4 py-2 text-sm font-medium backdrop-blur"
				style:top="{floatingMealsOffset}px"
			>
				<span
					class="rounded-sm px-2 py-1"
					class:bg-primary={isToday(day)}
					class:text-primary-foreground={isToday(day)}
				>
					{formatDayHeading(day)}
				</span>
			</div>
			<div class="space-y-2 px-4 py-2">
				{#each mealsForDate(day) as meal (meal.id)}
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

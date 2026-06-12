<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import { addDays, dailyScrollDays, dateFromKey, dateKey } from './schedule-date';
	import DailyScheduleDay from './daily-schedule-day.svelte';
	import MealPool from './meal-pool.svelte';
	import { sortScheduledMeals } from './schedule-ordering';
	import type { DailyScrollState } from '$lib/stores/ui-state';
	import type { Meal, MealCheckInHandler, MealDropTarget } from './schedule-types';

	const edgeThreshold = 480;
	const pageSize = 21;

	let {
		mealPool,
		plannedMeals,
		startDate,
		showMealPoolImages = false,
		todaySignal = 0,
		dayNavigationSignal = 0,
		dailyScroll = null,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onaddmeal,
		onpick,
		onselect,
		oncheckin,
		onscrollstatechange,
		onloadedrangechange
	}: {
		mealPool: Meal[];
		plannedMeals: Meal[];
		startDate: Date;
		showMealPoolImages?: boolean;
		todaySignal?: number;
		dayNavigationSignal?: number;
		dailyScroll?: DailyScrollState | null;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onaddmeal?: (date?: string) => void;
		onpick?: (meal: Meal, event: PointerEvent) => void;
		onselect?: (meal: Meal) => void;
		oncheckin?: MealCheckInHandler;
		onscrollstatechange?: (scrollState: DailyScrollState) => void;
		onloadedrangechange?: (range: { start: string; end: string }) => void;
	} = $props();

	let days = $state<Date[]>([]);
	let scroller: HTMLDivElement;
	let mealPoolElement: HTMLDivElement;
	let mealPoolOffset = $state(0);
	let mounted = false;
	let loadingMoreDays = false;
	let lastStartTime = $state(0);
	let lastDayNavigationSignal = $state(0);
	let scrollPersistFrame: number | undefined;
	let restoringScroll = false;
	let ignoreScrollPersistenceUntil = 0;

	const measureMealPoolOffset = () => {
		if (!scroller || !mealPoolElement) return;
		mealPoolOffset =
			mealPoolElement.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
	};

	const dayName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);
	const mealsForDate = (date: Date): Meal[] => {
		const key = dateKey(date);
		return sortScheduledMeals(
			plannedMeals.filter((meal) => meal.date === key || (!meal.date && meal.day === dayName(date)))
		);
	};

	const scrollToDate = async (date: Date, behavior: ScrollBehavior = 'auto', offset = 0) => {
		if (!browser || !scroller || !mealPoolElement) return;
		await tick();
		measureMealPoolOffset();
		const daySection = scroller.querySelector<HTMLElement>(`[data-day-key="${dateKey(date)}"]`);
		if (!daySection) return;
		const targetTop =
			scroller.scrollTop +
			daySection.getBoundingClientRect().top -
			mealPoolElement.getBoundingClientRect().bottom +
			offset;
		restoringScroll = true;
		ignoreScrollPersistenceUntil = performance.now() + 500;
		scroller.scrollTo({ top: Math.max(0, targetTop), behavior });
		requestAnimationFrame(() => {
			restoringScroll = false;
		});
	};

	const currentDailyScroll = (): DailyScrollState | undefined => {
		if (!scroller || !mealPoolElement) return;
		const anchorTop = mealPoolElement.getBoundingClientRect().bottom;
		const sections = Array.from(scroller.querySelectorAll<HTMLElement>('[data-day-key]'));
		let current = sections[0];
		for (const section of sections) {
			if (section.getBoundingClientRect().top <= anchorTop + 1) current = section;
			else break;
		}
		const date = current?.dataset.dayKey;
		if (!date || !current) return;
		return { date, offset: Math.max(0, anchorTop - current.getBoundingClientRect().top) };
	};

	const persistScrollPosition = () => {
		if (!browser || scrollPersistFrame !== undefined) return;
		scrollPersistFrame = requestAnimationFrame(() => {
			scrollPersistFrame = undefined;
			const scrollState = currentDailyScroll();
			if (scrollState) onscrollstatechange?.(scrollState);
		});
	};

	const currentVisibleAnchor = (): { date: string; offset: number } | undefined => {
		if (!scroller || !mealPoolElement) return;
		const anchorTop = mealPoolElement.getBoundingClientRect().bottom;
		const sections = Array.from(scroller.querySelectorAll<HTMLElement>('[data-day-key]'));
		const section =
			sections.find((daySection) => daySection.getBoundingClientRect().bottom > anchorTop + 1) ??
			sections[0];
		const date = section?.dataset.dayKey;
		return date ? { date, offset: section.getBoundingClientRect().top - anchorTop } : undefined;
	};

	const restoreVisibleAnchor = (anchor: { date: string; offset: number }) => {
		if (!scroller || !mealPoolElement) return;
		const section = scroller.querySelector<HTMLElement>(`[data-day-key="${anchor.date}"]`);
		if (!section) return;
		const anchorTop = mealPoolElement.getBoundingClientRect().bottom;
		const nextOffset = section.getBoundingClientRect().top - anchorTop;
		scroller.scrollTop += nextOffset - anchor.offset;
	};

	const prependDays = async () => {
		if (!scroller || loadingMoreDays) return;
		loadingMoreDays = true;
		restoringScroll = true;
		ignoreScrollPersistenceUntil = performance.now() + 500;
		const anchor = currentVisibleAnchor();
		const firstDay = days[0];
		days = [
			...Array.from({ length: pageSize }, (_, index) => addDays(firstDay, index - pageSize)),
			...days
		];
		await tick();
		measureMealPoolOffset();
		if (anchor) restoreVisibleAnchor(anchor);
		requestAnimationFrame(() => {
			restoringScroll = false;
		});
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

	const handleScroll = () => {
		loadMoreDays();
		if (!restoringScroll && performance.now() >= ignoreScrollPersistenceUntil) {
			persistScrollPosition();
		}
	};

	onMount(() => {
		mounted = true;
		measureMealPoolOffset();
		const resizeObserver = new ResizeObserver(measureMealPoolOffset);
		resizeObserver.observe(mealPoolElement);
		const restoreDate = dailyScroll?.date ? dateFromKey(dailyScroll.date) : startDate;
		void scrollToDate(restoreDate, 'auto', dailyScroll?.offset ?? 0);

		return () => {
			resizeObserver.disconnect();
			if (scrollPersistFrame !== undefined) cancelAnimationFrame(scrollPersistFrame);
		};
	});

	$effect(() => {
		const nextStartTime = startDate.getTime();
		const nextDayNavigationSignal = dayNavigationSignal;
		if (nextStartTime === lastStartTime && days.length > 0) return;
		const keyboardNavigation = nextDayNavigationSignal !== lastDayNavigationSignal;
		lastStartTime = nextStartTime;
		lastDayNavigationSignal = nextDayNavigationSignal;
		days = dailyScrollDays(startDate);
		const restoreDate = keyboardNavigation
			? startDate
			: dailyScroll?.date
				? dateFromKey(dailyScroll.date)
				: startDate;
		void scrollToDate(
			restoreDate,
			keyboardNavigation ? 'smooth' : 'auto',
			keyboardNavigation ? 0 : (dailyScroll?.offset ?? 0)
		);
	});

	$effect(() => {
		if (!days.length) return;
		onloadedrangechange?.({ start: dateKey(days[0]), end: dateKey(days.at(-1)!) });
	});

	$effect(() => {
		const signal = todaySignal;
		if (signal >= 0 && mounted) void scrollToDate(startDate, 'smooth');
	});
</script>

<div
	bind:this={scroller}
	data-daily-scroller
	data-drag-secondary-scroll
	onscroll={handleScroll}
	class="h-full min-w-0 [scrollbar-width:none] overflow-x-hidden overflow-y-auto [overflow-anchor:none] [&::-webkit-scrollbar]:hidden"
>
	<div
		bind:this={mealPoolElement}
		class="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur"
	>
		<MealPool
			{draggingMealId}
			{draggedMeal}
			{dropTarget}
			{onaddmeal}
			{onpick}
			{onselect}
			meals={mealPool}
			showImages={showMealPoolImages}
		/>
	</div>

	{#each days as day (day.toISOString())}
		<DailyScheduleDay
			{day}
			meals={mealsForDate(day)}
			{mealPoolOffset}
			{draggingMealId}
			{draggedMeal}
			{dropTarget}
			{onaddmeal}
			{onpick}
			{onselect}
			{oncheckin}
		/>
	{/each}
</div>

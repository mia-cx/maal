<script lang="ts">
	import { setDailyScroll, uiState, updateUiState } from '$lib/stores/ui-state';
	import ContinuousSchedule from './continuous-schedule.svelte';
	import MealDragOverlay from './meal-drag-overlay.svelte';
	import MealPreviewDialog from './meal-preview-dialog.svelte';
	import MonthSchedule from './month-schedule.svelte';
	import MultiDaySchedule from './multi-day-schedule.svelte';
	import ScheduleHeader from './schedule-header.svelte';
	import { addDays, addMonths, dateFromKey, dateKey, startOfDay } from './schedule-date';
	import { scheduleMeals } from './schedule-fixtures';
	import { dropTargetFromPointer, moveMealToDropTarget } from './schedule-dnd';
	import { isMealInPool, sortMealPool } from './schedule-ordering';
	import type { Meal, MealDropTarget, ScheduleMode } from './schedule-types';

	const initialUiState = uiState.get();
	const mealPoolImageMinHeight = 760;

	let mode = $state<ScheduleMode>(initialUiState.scheduleMode);
	let anchorDate = $state(dateFromKey(initialUiState.scheduleAnchorDate));
	let dailyScroll = $state(initialUiState.dailyScroll);
	let multiDayStep = $state(7);
	let todaySignal = $state(0);
	let dayNavigationSignal = $state(0);
	let dashboardHeight = $state(0);
	let meals = $state<Meal[]>(scheduleMeals.map((meal) => ({ ...meal })));
	let draggedMeal = $state<Meal | null>(null);
	let draggedPointerId = $state<number | null>(null);
	let selectedMeal = $state<Meal | null>(null);
	let previewOpen = $state(false);
	let dragX = $state(0);
	let dragY = $state(0);
	let dropTarget = $state<MealDropTarget | null>(null);
	let secondaryScrollPointerId: number | null = null;
	let secondaryScrollElement: HTMLElement | null = null;
	let secondaryScrollX = 0;
	let secondaryScrollY = 0;

	const mealPool = $derived(sortMealPool(meals.filter(isMealInPool)));
	const plannedMeals = $derived(meals.filter((meal) => !isMealInPool(meal)));
	const showDateControls = $derived(mode === 'daily' || mode === 'multi-day' || mode === 'monthly');
	const showStepControls = $derived(mode === 'multi-day' || mode === 'monthly');
	const showMealPoolImages = $derived(dashboardHeight >= mealPoolImageMinHeight);
	const scheduleModeByKey: Record<string, ScheduleMode> = {
		d: 'daily',
		w: 'multi-day',
		m: 'monthly'
	};

	const isEditableTarget = (target: EventTarget | null): boolean =>
		target instanceof Element &&
		Boolean(
			target.closest(
				'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
			)
		);

	const visibleMealCards = (): HTMLElement[] =>
		Array.from(document.querySelectorAll<HTMLElement>('[data-meal-card-id]')).filter((card) => {
			const rect = card.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0 && getComputedStyle(card).visibility !== 'hidden';
		});

	const focusMealCard = (activeCard: HTMLElement, direction: 'left' | 'right' | 'up' | 'down') => {
		const activeRect = activeCard.getBoundingClientRect();
		const activeX = activeRect.left + activeRect.width / 2;
		const activeY = activeRect.top + activeRect.height / 2;
		const horizontal = direction === 'left' || direction === 'right';
		const forward = direction === 'right' || direction === 'down';

		const nextCard = visibleMealCards()
			.filter((card) => card !== activeCard)
			.map((card) => {
				const rect = card.getBoundingClientRect();
				const x = rect.left + rect.width / 2;
				const y = rect.top + rect.height / 2;
				const primaryDelta = horizontal
					? forward
						? x - activeX
						: activeX - x
					: forward
						? y - activeY
						: activeY - y;
				const crossDelta = horizontal ? Math.abs(y - activeY) : Math.abs(x - activeX);
				return { card, primaryDelta, score: primaryDelta + crossDelta * 1.5 };
			})
			.filter((candidate) => candidate.primaryDelta > 2)
			.sort((left, right) => left.score - right.score)[0]?.card;

		if (!nextCard) return;
		nextCard.focus({ preventScroll: true });
		nextCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
	};

	const moveByDay = (dayDelta: number) => {
		anchorDate = startOfDay(addDays(anchorDate, dayDelta));
		dayNavigationSignal += 1;
		if (mode !== 'daily') return;
		dailyScroll = null;
		updateUiState({ dailyScroll: null });
	};

	const handleScheduleShortcut = (event: KeyboardEvent) => {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		if (isEditableTarget(event.target)) return;

		const activeMealCard =
			event.target instanceof Element
				? event.target.closest<HTMLElement>('[data-meal-card-id]')
				: null;
		const cardDirectionByKey: Record<string, 'left' | 'right' | 'up' | 'down'> = {
			ArrowLeft: 'left',
			ArrowRight: 'right',
			ArrowUp: 'up',
			ArrowDown: 'down',
			h: 'left',
			l: 'right',
			k: 'up',
			j: 'down'
		};
		const cardDirection =
			cardDirectionByKey[event.key] ?? cardDirectionByKey[event.key.toLowerCase()];
		if (activeMealCard && cardDirection) {
			event.preventDefault();
			focusMealCard(activeMealCard, cardDirection);
			return;
		}

		if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'h') {
			event.preventDefault();
			moveByDay(-1);
			return;
		}

		if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'l') {
			event.preventDefault();
			moveByDay(1);
			return;
		}

		const nextMode = scheduleModeByKey[event.key.toLowerCase()];
		if (!nextMode || nextMode === mode) return;
		event.preventDefault();
		mode = nextMode;
	};

	const previous = () => {
		anchorDate =
			mode === 'multi-day' ? addDays(anchorDate, -multiDayStep) : addMonths(anchorDate, -1);
	};

	const next = () => {
		anchorDate =
			mode === 'multi-day' ? addDays(anchorDate, multiDayStep) : addMonths(anchorDate, 1);
	};

	const today = () => {
		anchorDate = startOfDay(new Date());
		dailyScroll = null;
		updateUiState({ dailyScroll: null });
		todaySignal += 1;
	};

	const openDay = (date: Date) => {
		anchorDate = startOfDay(date);
		dailyScroll = null;
		updateUiState({ dailyScroll: null });
		mode = 'daily';
	};

	const updateDailyScroll = (scrollState: NonNullable<typeof dailyScroll>) => {
		dailyScroll = scrollState;
		setDailyScroll(scrollState);
	};

	const updateMultiDayAnchor = (date: Date) => {
		anchorDate = startOfDay(date);
	};

	const previewMeal = (meal: Meal) => {
		selectedMeal = meal;
		previewOpen = true;
	};

	const startMealDrag = (meal: Meal, event: PointerEvent) => {
		if (draggedMeal) return;
		draggedMeal = meal;
		draggedPointerId = event.pointerId;
		dragX = event.clientX;
		dragY = event.clientY;
		dropTarget = dropTargetFromPointer(event, meal, meals);
	};

	const startSecondaryTouchScroll = (event: PointerEvent) => {
		if (!draggedMeal || event.pointerType !== 'touch' || event.pointerId === draggedPointerId)
			return;
		if (secondaryScrollPointerId !== null) return;
		const scrollElement =
			event.target instanceof Element
				? event.target.closest<HTMLElement>('[data-drag-secondary-scroll]')
				: null;
		if (!scrollElement) return;
		secondaryScrollPointerId = event.pointerId;
		secondaryScrollElement = scrollElement;
		secondaryScrollX = event.clientX;
		secondaryScrollY = event.clientY;
	};

	const moveSecondaryTouchScroll = (event: PointerEvent): boolean => {
		if (secondaryScrollPointerId !== event.pointerId || !secondaryScrollElement) return false;
		secondaryScrollElement.scrollLeft -= event.clientX - secondaryScrollX;
		secondaryScrollElement.scrollTop -= event.clientY - secondaryScrollY;
		secondaryScrollX = event.clientX;
		secondaryScrollY = event.clientY;
		event.preventDefault();
		return true;
	};

	const clearSecondaryTouchScroll = (event: PointerEvent): boolean => {
		if (secondaryScrollPointerId !== event.pointerId) return false;
		secondaryScrollPointerId = null;
		secondaryScrollElement = null;
		return true;
	};

	const moveMealDrag = (event: PointerEvent) => {
		if (moveSecondaryTouchScroll(event)) return;
		if (!draggedMeal || draggedPointerId !== event.pointerId) return;
		dragX = event.clientX;
		dragY = event.clientY;
		dropTarget = dropTargetFromPointer(event, draggedMeal, meals);
	};

	const updateDraggedMeal = (target: MealDropTarget) => {
		if (!draggedMeal) return;
		meals = moveMealToDropTarget(meals, draggedMeal, target);
	};

	const stopMealDrag = (event: PointerEvent) => {
		if (clearSecondaryTouchScroll(event)) return;
		if (!draggedMeal || draggedPointerId !== event.pointerId) return;
		if (dropTarget) updateDraggedMeal(dropTarget);
		draggedMeal = null;
		draggedPointerId = null;
		dropTarget = null;
		secondaryScrollPointerId = null;
		secondaryScrollElement = null;
	};

	$effect(() => {
		updateUiState({ scheduleMode: mode, scheduleAnchorDate: dateKey(anchorDate) });
	});
</script>

<svelte:window
	onpointerdown={startSecondaryTouchScroll}
	onpointermove={moveMealDrag}
	onpointerup={stopMealDrag}
	onpointercancel={stopMealDrag}
	onkeydown={handleScheduleShortcut}
/>

<section
	bind:clientHeight={dashboardHeight}
	class="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground"
	class:select-none={draggedMeal}
>
	<ScheduleHeader
		{mode}
		{showDateControls}
		{showStepControls}
		onmodechange={(nextMode) => (mode = nextMode)}
		onprevious={previous}
		onnext={next}
		ontoday={today}
	/>

	<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
		{#if mode === 'daily'}
			<ContinuousSchedule
				{mealPool}
				{plannedMeals}
				{showMealPoolImages}
				startDate={anchorDate}
				{todaySignal}
				{dayNavigationSignal}
				{dailyScroll}
				draggingMealId={draggedMeal?.id}
				{draggedMeal}
				{dropTarget}
				onpick={startMealDrag}
				onselect={previewMeal}
				onscrollstatechange={updateDailyScroll}
			/>
		{:else if mode === 'multi-day'}
			<MultiDaySchedule
				{mealPool}
				{plannedMeals}
				{showMealPoolImages}
				{anchorDate}
				{dayNavigationSignal}
				draggingMealId={draggedMeal?.id}
				{draggedMeal}
				{dropTarget}
				onpick={startMealDrag}
				onselect={previewMeal}
				onanchordatechange={updateMultiDayAnchor}
				onvisibledaycountchange={(dayCount) => (multiDayStep = dayCount)}
			/>
		{:else}
			<MonthSchedule
				{mealPool}
				{plannedMeals}
				{showMealPoolImages}
				{anchorDate}
				draggingMealId={draggedMeal?.id}
				{draggedMeal}
				{dropTarget}
				onpick={startMealDrag}
				onselect={previewMeal}
				onselectdate={openDay}
			/>
		{/if}
	</div>

	<MealDragOverlay meal={draggedMeal} x={dragX} y={dragY} />
	<MealPreviewDialog bind:open={previewOpen} meal={selectedMeal} />
</section>

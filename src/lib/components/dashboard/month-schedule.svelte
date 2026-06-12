<script lang="ts">
	import {
		createFastScrollGate,
		createGridSnapper,
		createRetargetableScroll,
		createWheelGestureClassifier,
		preservePrependScrollPosition,
		startInertiaScroll as startSdkInertiaScroll,
		touchById,
		type ProgrammaticScrollBehavior
	} from '$lib/interaction/scroll-sdk';
	import { onMount, tick } from 'svelte';
	import MealPool from './meal-pool.svelte';
	import MonthDayCell from './month-day-cell.svelte';
	import {
		addDays,
		addMonths,
		dateFromKey,
		dateKey,
		formatMonthHeading,
		startOfDay,
		startOfWeek
	} from './schedule-date';
	import { sortScheduledMeals } from './schedule-ordering';
	import type { Meal, MealCheckInHandler, MealDropTarget } from './schedule-types';
	import { scheduleDaysFor } from './schedule-types';

	const pageSizeWeeks = 6;
	const visibleWeekCount = 6;
	const trackpadInputActiveMs = 360;
	const trackpadTailSnapIdleMs = 96;
	const touchPanThresholdPx = 6;
	const touchVerticalAxisBias = 0.72;
	const touchDistanceSnapRatio = 0.28;
	const touchNearestSnapRatio = 0.85;
	const touchMinDistanceSnapPx = 44;
	const touchVelocityThreshold = 0.16;
	const touchInertiaSnapVelocityThreshold = 1.0;
	const touchInertiaDecay = 0.82;
	const touchSnapIdleMs = 120;
	const dragVelocityThreshold = 0.32;
	const dragInertiaSnapVelocityThreshold = 1.0;
	const dragInertiaDecay = 0.82;
	const dragSnapIdleMs = 120;
	const discreteWheelActiveMs = 180;
	const scrollSnapIdleMs = 140;

	let {
		mealPool,
		plannedMeals,
		showMealPoolImages = false,
		anchorDate,
		weekStartsOn = 'monday',
		draggingMealId,
		draggedMeal,
		dropTarget,
		onaddmeal,
		onpick,
		onselect,
		oncheckin,
		onselectdate,
		onanchordatechange,
		onloadedrangechange
	}: {
		mealPool: Meal[];
		plannedMeals: Meal[];
		showMealPoolImages?: boolean;
		anchorDate: Date;
		weekStartsOn?: 'sunday' | 'monday';
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onaddmeal?: (date?: string) => void;
		onpick?: (meal: Meal, event: PointerEvent) => void;
		onselect?: (meal: Meal) => void;
		oncheckin?: MealCheckInHandler;
		onselectdate?: (date: Date) => void;
		onanchordatechange?: (date: Date) => void;
		onloadedrangechange?: (range: { start: string; end: string }) => void;
	} = $props();

	let weeks = $state<Date[]>([]);
	let scroller: HTMLDivElement;
	let contentHeight = $state(0);
	let loadingMoreWeeks = false;
	let scrollFrame: number | undefined;
	let cancelInertiaScroll: (() => void) | undefined;
	let scrollReleaseTimeout: ReturnType<typeof setTimeout> | undefined;
	let suppressAnchorUpdate = false;
	let draggingScroller = $state(false);
	let pendingDragScrollPointerId: number | null = null;
	let dragStartY = 0;
	let dragStartScrollTop = 0;
	let dragLastY = 0;
	let dragLastTime = 0;
	let dragVelocity = 0;
	let touchScrollId: number | undefined;
	let touchScrollAxis: 'horizontal' | 'vertical' | undefined;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartScrollTop = 0;
	let touchStartWeek: Date | undefined;
	let touchTotalY = 0;
	let touchLastY = 0;
	let touchLastTime = 0;
	let touchVelocity = 0;
	let snapTimeout: ReturnType<typeof setTimeout> | undefined;
	let reflowTimeout: ReturnType<typeof setTimeout> | undefined;
	let wheelTargetClearTimeout: ReturnType<typeof setTimeout> | undefined;
	let reflowingLayout = false;
	let wheelTargetWeek: Date | undefined;
	let wheelInputActiveUntil = 0;
	let directionalWheelSnapUntil = 0;
	let directionalWheelSnapDelay = trackpadInputActiveMs;
	let lastScrollTop = 0;
	let lastAnchorTime = $state(0);
	let lastContentHeight = $state(0);
	let lastAnnouncedKey = $state('');
	let fastScrollOverlayLabel = $state('');
	let fastScrollOverlayVisible = $state(false);

	const weeksAround = (date: Date): Date[] => {
		const start = addDays(startOfWeek(date, weekStartsOn), -pageSizeWeeks * 7);
		return Array.from({ length: pageSizeWeeks * 3 }, (_, index) => addDays(start, index * 7));
	};

	const daysForWeek = (weekStart: Date): Date[] =>
		Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

	const displayDateForWeek = (weekStart: Date): Date => startOfDay(addDays(weekStart, 3));

	const dayName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);
	const fastScrollMonthFormatter = new Intl.DateTimeFormat('en', {
		month: 'long',
		year: 'numeric'
	});
	const mealsForDate = (date: Date): Meal[] => {
		const key = dateKey(date);
		return sortScheduledMeals(
			plannedMeals.filter((meal) => meal.date === key || (!meal.date && meal.day === dayName(date)))
		);
	};

	const ensureDateLoaded = (date: Date) => {
		const weekKey = dateKey(startOfWeek(date, weekStartsOn));
		if (weeks.some((week) => dateKey(week) === weekKey)) return;
		weeks = weeksAround(date);
	};

	const wheelGesture = createWheelGestureClassifier();

	const fastScrollGate = createFastScrollGate<Date>({
		debugName: 'monthly',
		label: (date) => fastScrollMonthFormatter.format(date),
		onOverlayChange: ({ visible, label }) => {
			fastScrollOverlayVisible = visible;
			fastScrollOverlayLabel = label;
		}
	});

	const cancelProgrammaticScroll = () => {
		verticalScroll.cancel();
		cancelInertiaScroll?.();
		cancelInertiaScroll = undefined;
		if (scrollReleaseTimeout) clearTimeout(scrollReleaseTimeout);
		scrollReleaseTimeout = undefined;
	};

	const releaseAnchorUpdateSuppression = (delay = 80) => {
		if (scrollReleaseTimeout) clearTimeout(scrollReleaseTimeout);
		scrollReleaseTimeout = setTimeout(() => {
			suppressAnchorUpdate = false;
			scrollReleaseTimeout = undefined;
		}, delay);
	};

	const verticalScroll = createRetargetableScroll({
		axis: 'y',
		getElement: () => scroller,
		onSettle: () => releaseAnchorUpdateSuppression()
	});

	const weekGrid = createGridSnapper({
		getElement: () => scroller,
		grid: { y: { selector: '[data-week-start]', dataAttribute: 'weekStart' } },
		scroll: { y: verticalScroll }
	});

	const scrollToWeek = async (
		date: Date,
		behavior: ProgrammaticScrollBehavior = 'auto'
	): Promise<boolean> => {
		if (!scroller) return false;
		await tick();
		suppressAnchorUpdate = true;
		if (snapTimeout) clearTimeout(snapTimeout);
		return weekGrid.scrollToKey('y', dateKey(startOfWeek(date)), behavior);
	};

	const prependWeeks = async () => {
		if (!scroller || loadingMoreWeeks) return;
		loadingMoreWeeks = true;
		cancelProgrammaticScroll();
		suppressAnchorUpdate = true;
		const firstWeek = weeks[0];
		await preservePrependScrollPosition(
			scroller,
			'y',
			() => {
				weeks = [
					...Array.from({ length: pageSizeWeeks }, (_, index) =>
						addDays(firstWeek, (index - pageSizeWeeks) * 7)
					),
					...weeks
				];
			},
			() => tick()
		);
		releaseAnchorUpdateSuppression();
		loadingMoreWeeks = false;
	};

	const appendWeeks = async () => {
		if (loadingMoreWeeks) return;
		loadingMoreWeeks = true;
		const lastWeek = weeks.at(-1)!;
		weeks = [
			...weeks,
			...Array.from({ length: pageSizeWeeks }, (_, index) => addDays(lastWeek, (index + 1) * 7))
		];
		await tick();
		loadingMoreWeeks = false;
	};

	const currentTopWeek = (): Date | undefined => {
		const key = weekGrid.keyAtEdge('y');
		return key ? dateFromKey(key) : undefined;
	};

	const weekRowHeight = $derived(Math.max(96, contentHeight / visibleWeekCount || 96));
	const rowHeight = (): number => weekRowHeight;

	const loadMoreWeeks = () => {
		if (!scroller) return;
		const edgeThreshold = Math.max(contentHeight, rowHeight() * 2);
		if (scroller.scrollTop < edgeThreshold) void prependWeeks();
		const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
		if (remaining < edgeThreshold) void appendWeeks();
	};

	const publishAnchorDate = () => {
		if (suppressAnchorUpdate || draggingScroller || reflowingLayout) return;
		const week = currentTopWeek();
		if (!week) return;
		const displayDate = displayDateForWeek(week);
		const key = dateKey(displayDate);
		if (key === lastAnnouncedKey) return;
		lastAnnouncedKey = key;
		lastAnchorTime = displayDate.getTime();
		onanchordatechange?.(displayDate);
	};

	const publishWeekAndScroll = (week: Date) => {
		const displayDate = displayDateForWeek(week);
		lastAnnouncedKey = dateKey(displayDate);
		lastAnchorTime = displayDate.getTime();
		onanchordatechange?.(displayDate);
		void scrollToWeek(week, 'animated');
	};

	const snapToNearestWeek = () => {
		if (draggingScroller) return;
		const week = currentTopWeek();
		if (!week) return;
		publishWeekAndScroll(week);
	};

	const currentDirectionalWeek = (direction: number): Date | undefined => {
		const key = weekGrid.keyAtEdge('y', direction);
		return key ? dateFromKey(key) : currentTopWeek();
	};

	const snapToDirectionalWeek = (direction: number) => {
		if (draggingScroller) return;
		const week = currentDirectionalWeek(direction);
		if (!week) return;
		publishWeekAndScroll(week);
	};

	const scheduleSnapToNearestWeek = (delay = scrollSnapIdleMs, direction = 0) => {
		if (draggingScroller || suppressAnchorUpdate || reflowingLayout) return;
		if (snapTimeout) clearTimeout(snapTimeout);
		const inputQuietDelay = Math.max(delay, wheelInputActiveUntil - performance.now());
		snapTimeout = setTimeout(() => {
			snapTimeout = undefined;
			if (direction) {
				snapToDirectionalWeek(Math.sign(direction));
				return;
			}
			snapToNearestWeek();
		}, inputQuietDelay);
	};

	const handleScroll = () => {
		if (!scroller) return;
		const nextScrollTop = scroller.scrollTop;
		const verticalScrollDelta = nextScrollTop - lastScrollTop;
		const verticalScrollChanged = Math.abs(verticalScrollDelta) > 0.5;
		lastScrollTop = nextScrollTop;
		const verticalScrollDirection = Math.sign(verticalScrollDelta);
		const now = performance.now();
		if (verticalScrollChanged && verticalScrollDirection && now <= directionalWheelSnapUntil) {
			directionalWheelSnapUntil = now + directionalWheelSnapDelay;
		}
		loadMoreWeeks();
		if (scrollFrame === undefined) {
			scrollFrame = requestAnimationFrame(() => {
				scrollFrame = undefined;
				publishAnchorDate();
			});
		}
		scheduleSnapToNearestWeek(
			scrollSnapIdleMs,
			performance.now() <= directionalWheelSnapUntil ? verticalScrollDirection : 0
		);
	};

	const clearWheelTargetSoon = () => {
		if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
		wheelTargetClearTimeout = setTimeout(() => {
			wheelTargetWeek = undefined;
			wheelTargetClearTimeout = undefined;
		}, discreteWheelActiveMs);
	};

	const scrollByWheelStep = async (direction: number) => {
		const topWeek = wheelTargetWeek ?? currentTopWeek() ?? startOfWeek(anchorDate);
		const fastDisplayDate = startOfDay(addMonths(displayDateForWeek(topWeek), direction));
		const fastScroll = fastScrollGate.shouldSkipAnimation(direction, fastDisplayDate);
		const nextWeek = fastScroll
			? startOfWeek(fastDisplayDate, weekStartsOn)
			: addDays(topWeek, direction * 7);
		const displayDate = fastScroll ? fastDisplayDate : displayDateForWeek(nextWeek);
		const behavior: ProgrammaticScrollBehavior = fastScroll ? 'auto' : 'animated';
		wheelTargetWeek = nextWeek;
		clearWheelTargetSoon();
		ensureDateLoaded(nextWeek);
		lastAnnouncedKey = dateKey(displayDate);
		lastAnchorTime = displayDate.getTime();
		onanchordatechange?.(displayDate);
		const snapped = await scrollToWeek(nextWeek, behavior);
		if (!snapped && scroller) {
			scroller.scrollTop += direction * (fastScroll ? rowHeight() * visibleWeekCount : rowHeight());
		}
	};

	const clearPendingSnap = () => {
		if (!snapTimeout) return;
		clearTimeout(snapTimeout);
		snapTimeout = undefined;
	};

	const clearTouchInput = () => {
		wheelInputActiveUntil = 0;
		directionalWheelSnapUntil = 0;
		directionalWheelSnapDelay = trackpadInputActiveMs;
	};

	const snapAfterTouch = (direction?: number) => {
		clearPendingSnap();
		clearTouchInput();
		suppressAnchorUpdate = false;
		if (direction) {
			snapToDirectionalWeek(direction);
			return;
		}
		snapToNearestWeek();
	};

	const snapTouchDistance = (): number =>
		Math.max(touchMinDistanceSnapPx, rowHeight() * touchDistanceSnapRatio);

	const snapTouchNearestDistance = (): number => rowHeight() * touchNearestSnapRatio;

	const snapToTouchAdjacentWeek = (direction: number) => {
		const baseWeek = touchStartWeek ?? currentTopWeek() ?? startOfWeek(anchorDate, weekStartsOn);
		const nextWeek = addDays(baseWeek, direction * 7);
		ensureDateLoaded(nextWeek);
		const displayDate = displayDateForWeek(nextWeek);
		lastAnnouncedKey = dateKey(displayDate);
		lastAnchorTime = displayDate.getTime();
		onanchordatechange?.(displayDate);
		void scrollToWeek(nextWeek, 'animated');
	};

	const startInertiaScroll = (
		velocity: number,
		snapVelocityThreshold = touchInertiaSnapVelocityThreshold,
		decay = touchInertiaDecay,
		snapIdleMs = touchSnapIdleMs
	) => {
		if (!scroller) return;
		cancelProgrammaticScroll();
		const keepInputActive = () => (wheelInputActiveUntil = performance.now() + snapIdleMs);
		keepInputActive();
		cancelInertiaScroll = startSdkInertiaScroll({
			axis: 'y',
			getElement: () => scroller,
			velocity,
			snapVelocityThreshold,
			decay,
			onActive: keepInputActive,
			onSettle: () => {
				cancelInertiaScroll = undefined;
				snapAfterTouch(Math.sign(velocity));
			}
		});
	};

	const startTouchScroll = (event: TouchEvent) => {
		if (!scroller || event.touches.length !== 1 || draggingMealId) return;
		const touch = event.changedTouches[0];
		clearPendingSnap();
		clearTouchInput();
		cancelProgrammaticScroll();
		suppressAnchorUpdate = false;
		touchScrollId = touch.identifier;
		touchScrollAxis = undefined;
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchStartScrollTop = scroller.scrollTop;
		touchStartWeek = currentTopWeek() ?? startOfWeek(anchorDate, weekStartsOn);
		touchTotalY = 0;
		touchLastY = touch.clientY;
		touchLastTime = performance.now();
		touchVelocity = 0;
	};

	const moveTouchScroll = (event: TouchEvent) => {
		if (!scroller || touchScrollId === undefined || draggingMealId || reflowingLayout) return;
		const touch = touchById(event.touches, touchScrollId);
		if (!touch) return;
		const totalX = touch.clientX - touchStartX;
		const totalY = touch.clientY - touchStartY;

		if (!touchScrollAxis) {
			if (Math.hypot(totalX, totalY) < touchPanThresholdPx) return;
			touchScrollAxis =
				Math.abs(totalY) >= Math.abs(totalX) * touchVerticalAxisBias ? 'vertical' : 'horizontal';
		}

		if (touchScrollAxis !== 'vertical') return;

		event.preventDefault();
		clearPendingSnap();
		wheelTargetWeek = undefined;
		if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
		wheelTargetClearTimeout = undefined;
		const now = performance.now();
		const delta = touchLastY - touch.clientY;
		const elapsed = Math.max(1, now - touchLastTime);
		touchVelocity = touchVelocity * 0.62 + (delta / elapsed) * 0.38;
		touchTotalY = totalY;
		wheelInputActiveUntil = now + touchSnapIdleMs;
		scroller.scrollTop = touchStartScrollTop - totalY;
		touchLastY = touch.clientY;
		touchLastTime = now;
	};

	const stopTouchScroll = (event: TouchEvent) => {
		if (touchScrollId === undefined) return;
		const touchEnded = Boolean(touchById(event.changedTouches, touchScrollId));
		if (!touchEnded) return;
		const wasVertical = touchScrollAxis === 'vertical';
		const releaseVelocity = touchVelocity;
		const releaseDistance = touchTotalY;
		touchScrollId = undefined;
		touchScrollAxis = undefined;
		touchVelocity = 0;
		touchTotalY = 0;
		if (!wasVertical || !scroller) return;

		if (Math.abs(releaseVelocity) >= touchVelocityThreshold) {
			startInertiaScroll(releaseVelocity, touchInertiaSnapVelocityThreshold);
			return;
		}

		if (Math.abs(releaseDistance) >= snapTouchNearestDistance()) {
			snapAfterTouch();
			return;
		}

		if (Math.abs(releaseDistance) >= snapTouchDistance()) {
			snapToTouchAdjacentWeek(releaseDistance < 0 ? 1 : -1);
			return;
		}

		snapAfterTouch();
	};

	const handleWheel = (event: WheelEvent) => {
		if (!scroller) return;
		const delta = event.deltaY;
		if (!delta) return;

		const wheel = wheelGesture.classify(event);
		if (wheel.kind === 'continuous') {
			if (draggingScroller || reflowingLayout) return;
			clearPendingSnap();
			wheelTargetWeek = undefined;
			if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
			wheelTargetClearTimeout = undefined;
			const now = performance.now();
			const snapDelay = wheel.settleSoon ? trackpadTailSnapIdleMs : trackpadInputActiveMs;
			wheelInputActiveUntil = now + snapDelay;
			directionalWheelSnapDelay = snapDelay;
			directionalWheelSnapUntil = now + snapDelay;
			cancelProgrammaticScroll();
			suppressAnchorUpdate = false;
			scheduleSnapToNearestWeek(snapDelay, Math.sign(wheel.dominantDelta));
			return;
		}

		if (wheel.kind === 'pending') return;

		event.preventDefault();
		event.stopPropagation();
		if (draggingScroller || reflowingLayout) return;
		clearPendingSnap();

		directionalWheelSnapUntil = 0;
		directionalWheelSnapDelay = trackpadInputActiveMs;
		wheelInputActiveUntil = performance.now() + discreteWheelActiveMs;
		void scrollByWheelStep(delta > 0 ? 1 : -1);
	};

	const startDragScroll = (event: PointerEvent) => {
		if (!scroller || event.pointerType === 'touch' || event.button !== 0) return;
		if (
			event.target instanceof Element &&
			event.target.closest(
				'button, a, input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-meal-card-id]'
			)
		)
			return;
		pendingDragScrollPointerId = event.pointerId;
		dragStartY = event.clientY;
		dragStartScrollTop = scroller.scrollTop;
		dragLastY = event.clientY;
		dragLastTime = performance.now();
		dragVelocity = 0;
	};

	const dragScroll = (event: PointerEvent) => {
		if (!scroller || pendingDragScrollPointerId !== event.pointerId) return;
		if (!draggingScroller) {
			if (Math.abs(event.clientY - dragStartY) < touchPanThresholdPx) return;
			clearPendingSnap();
			clearTouchInput();
			cancelProgrammaticScroll();
			suppressAnchorUpdate = false;
			draggingScroller = true;
			scroller.setPointerCapture(event.pointerId);
		}
		const now = performance.now();
		const delta = dragLastY - event.clientY;
		const elapsed = Math.max(1, now - dragLastTime);
		dragVelocity = dragVelocity * 0.62 + (delta / elapsed) * 0.38;
		wheelInputActiveUntil = now + dragSnapIdleMs;
		scroller.scrollTop = dragStartScrollTop - (event.clientY - dragStartY);
		dragLastY = event.clientY;
		dragLastTime = now;
		event.preventDefault();
	};

	const stopDragScroll = (event: PointerEvent) => {
		if (!scroller || pendingDragScrollPointerId !== event.pointerId) return;
		pendingDragScrollPointerId = null;
		if (!draggingScroller) return;
		const releaseVelocity = dragVelocity;
		draggingScroller = false;
		dragVelocity = 0;
		if (scroller.hasPointerCapture(event.pointerId))
			scroller.releasePointerCapture(event.pointerId);
		if (Math.abs(releaseVelocity) >= dragVelocityThreshold) {
			startInertiaScroll(
				releaseVelocity,
				dragInertiaSnapVelocityThreshold,
				dragInertiaDecay,
				dragSnapIdleMs
			);
			return;
		}
		snapAfterTouch();
	};

	onMount(() => {
		ensureDateLoaded(anchorDate);
		lastAnnouncedKey = dateKey(anchorDate);
		void scrollToWeek(anchorDate);
		scroller?.addEventListener('wheel', handleWheel, { passive: false });
		scroller?.addEventListener('touchstart', startTouchScroll, { passive: true });
		scroller?.addEventListener('touchmove', moveTouchScroll, { passive: false });
		scroller?.addEventListener('touchend', stopTouchScroll);
		scroller?.addEventListener('touchcancel', stopTouchScroll);
		return () => {
			scroller?.removeEventListener('wheel', handleWheel);
			scroller?.removeEventListener('touchstart', startTouchScroll);
			scroller?.removeEventListener('touchmove', moveTouchScroll);
			scroller?.removeEventListener('touchend', stopTouchScroll);
			scroller?.removeEventListener('touchcancel', stopTouchScroll);
			if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
			cancelProgrammaticScroll();
			if (snapTimeout) clearTimeout(snapTimeout);
			if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
			if (reflowTimeout) clearTimeout(reflowTimeout);
			wheelGesture.reset();
			fastScrollGate.destroy();
		};
	});

	$effect(() => {
		const nextContentHeight = contentHeight;
		if (nextContentHeight === lastContentHeight || weeks.length === 0) return;
		lastContentHeight = nextContentHeight;

		reflowingLayout = true;
		clearPendingSnap();
		if (reflowTimeout) clearTimeout(reflowTimeout);

		const stableDate = lastAnnouncedKey ? dateFromKey(lastAnnouncedKey) : anchorDate;
		void scrollToWeek(stableDate);
		reflowTimeout = setTimeout(() => {
			reflowingLayout = false;
			void scrollToWeek(stableDate);
		}, 180);
	});

	$effect(() => {
		if (!weeks.length) return;
		onloadedrangechange?.({
			start: dateKey(weeks[0]),
			end: dateKey(addDays(weeks.at(-1)!, 6))
		});
	});

	$effect(() => {
		const nextAnchorTime = anchorDate.getTime();
		if (nextAnchorTime === lastAnchorTime && weeks.length > 0) return;
		lastAnchorTime = nextAnchorTime;
		ensureDateLoaded(anchorDate);
		lastAnnouncedKey = dateKey(anchorDate);
		void scrollToWeek(anchorDate, 'animated');
	});
</script>

<div class="flex h-full min-w-0 flex-col overflow-hidden">
	<div class="border-b border-border">
		<MealPool
			{draggingMealId}
			{draggedMeal}
			{dropTarget}
			{onaddmeal}
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
		{#each scheduleDaysFor(weekStartsOn) as day, index (day)}
			<div
				class="min-w-0 border-border px-4 py-1 text-xs font-medium text-muted-foreground"
				class:border-l={index > 0}
			>
				<span class="inline-flex h-5 items-center">{day}</span>
			</div>
		{/each}
	</div>
	<div class="relative min-h-0 flex-1">
		<div
			bind:this={scroller}
			bind:clientHeight={contentHeight}
			data-drag-secondary-scroll
			role="region"
			aria-label="Monthly schedule"
			onscroll={handleScroll}
			onpointerdown={startDragScroll}
			onpointermove={dragScroll}
			onpointerup={stopDragScroll}
			onpointercancel={stopDragScroll}
			class="h-full min-h-0 touch-pan-x [scrollbar-width:none] overflow-x-hidden overflow-y-auto overscroll-y-none [overflow-anchor:none] [&::-webkit-scrollbar]:hidden"
			class:select-none={draggingScroller}
		>
			<div class="grid grid-cols-1" style="grid-auto-rows: {weekRowHeight}px;">
				{#each weeks as week, weekIndex (dateKey(week))}
					<div
						data-week-start={dateKey(week)}
						class="grid min-h-0 grid-cols-[repeat(7,minmax(0,1fr))]"
					>
						{#each daysForWeek(week) as day, dayIndex (dateKey(day))}
							<MonthDayCell
								{day}
								index={weekIndex * 7 + dayIndex}
								{anchorDate}
								meals={mealsForDate(day)}
								{draggingMealId}
								{draggedMeal}
								{dropTarget}
								{onaddmeal}
								{onpick}
								{onselect}
								{oncheckin}
								{onselectdate}
							/>
						{/each}
					</div>
				{/each}
			</div>
		</div>
		{#if fastScrollOverlayVisible}
			<div
				class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-foreground/10 backdrop-blur-[1px] dark:bg-background/45"
			>
				<div
					class="rounded-md border border-border bg-background/90 px-4 py-2 text-sm font-semibold shadow-sm"
				>
					{fastScrollOverlayLabel}
				</div>
			</div>
		{/if}
	</div>
</div>

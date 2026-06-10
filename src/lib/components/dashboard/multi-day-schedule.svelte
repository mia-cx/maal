<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { addDays, dateFromKey, dateKey, formatWeekHeading, startOfDay } from './schedule-date';
	import MealPool from './meal-pool.svelte';
	import MultiDayColumn from './multi-day-column.svelte';
	import { sortScheduledMeals } from './schedule-ordering';
	import type { Meal, MealDropTarget } from './schedule-types';

	const pageSize = 21;
	const minDayColumnWidth = 144;
	const trackpadDeltaFriction = 0.68;
	const trackpadSnapIdleMs = 280;
	const touchPanThresholdPx = 6;
	const touchHorizontalAxisBias = 0.72;
	const touchVerticalMomentumWindowMs = 360;
	const touchVerticalMomentumHorizontalThresholdPx = 2;
	const touchVerticalMomentumHorizontalBias = 0.35;
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
		dayNavigationSignal = 0,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onpick,
		onselect,
		onanchordatechange,
		onvisibledaycountchange
	}: {
		mealPool: Meal[];
		plannedMeals: Meal[];
		showMealPoolImages?: boolean;
		anchorDate: Date;
		dayNavigationSignal?: number;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onpick?: (meal: Meal, event: PointerEvent) => void;
		onselect?: (meal: Meal) => void;
		onanchordatechange?: (date: Date) => void;
		onvisibledaycountchange?: (dayCount: number) => void;
	} = $props();

	let days = $state<Date[]>([]);
	let scroller: HTMLDivElement;
	let contentWidth = $state(0);
	let loadingMoreDays = false;
	let scrollFrame: number | undefined;
	let scrollAnimationFrame: number | undefined;
	let scrollReleaseTimeout: ReturnType<typeof setTimeout> | undefined;
	let suppressAnchorUpdate = false;
	let draggingScroller = $state(false);
	let dragStartX = 0;
	let dragStartScrollLeft = 0;
	let dragLastX = 0;
	let dragLastTime = 0;
	let dragVelocity = 0;
	let touchScrollId: number | undefined;
	let touchScrollAxis: 'horizontal' | 'vertical' | undefined;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartScrollLeft = 0;
	let touchStartDate: Date | undefined;
	let touchTotalX = 0;
	let touchStartedDuringVerticalMomentum = false;
	let touchLastX = 0;
	let touchLastTime = 0;
	let touchVelocity = 0;
	let snapTimeout: ReturnType<typeof setTimeout> | undefined;
	let reflowTimeout: ReturnType<typeof setTimeout> | undefined;
	let wheelTargetClearTimeout: ReturnType<typeof setTimeout> | undefined;
	let reflowingLayout = false;
	let wheelTargetDate: Date | undefined;
	let wheelInputActiveUntil = 0;
	let lastStartTime = $state(0);
	let lastDayNavigationSignal = $state(0);
	let lastContentWidth = $state(0);
	let lastVisibleDayCount = $state(0);
	let lastAnnouncedKey = $state('');
	let lastScrollLeft = 0;
	let lastScrollTop = 0;
	let lastVerticalScrollTime = 0;

	const visibleDayCount = $derived(
		Math.min(7, Math.max(1, Math.floor(contentWidth / minDayColumnWidth) || 1))
	);

	const daysAround = (date: Date): Date[] => {
		const start = addDays(startOfDay(date), -pageSize);
		return Array.from({ length: pageSize * 3 }, (_, index) => addDays(start, index));
	};

	const dayName = (date: Date): string =>
		new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);
	const mealsForDate = (date: Date): Meal[] => {
		const key = dateKey(date);
		return sortScheduledMeals(
			plannedMeals.filter((meal) => meal.date === key || (!meal.date && meal.day === dayName(date)))
		);
	};

	const ensureDateLoaded = (date: Date) => {
		const key = dateKey(date);
		if (days.some((day) => dateKey(day) === key)) return;
		days = daysAround(date);
	};

	const easeOutCubic = (progress: number): number => 1 - Math.pow(1 - progress, 3);

	const cancelProgrammaticScroll = () => {
		if (scrollAnimationFrame !== undefined) cancelAnimationFrame(scrollAnimationFrame);
		scrollAnimationFrame = undefined;
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

	const scrollToLeft = (left: number, behavior: ScrollBehavior) => {
		if (!scroller) return;
		cancelProgrammaticScroll();
		const targetLeft = Math.max(0, left);
		if (behavior !== 'smooth') {
			scroller.scrollTo({ left: targetLeft, behavior: 'auto' });
			releaseAnchorUpdateSuppression();
			return;
		}

		const startLeft = scroller.scrollLeft;
		const distance = targetLeft - startLeft;
		const duration = Math.min(260, Math.max(140, Math.abs(distance) * 0.45));
		const startTime = performance.now();

		const step = (time: number) => {
			const progress = Math.min(1, (time - startTime) / duration);
			scroller!.scrollLeft = startLeft + distance * easeOutCubic(progress);
			if (progress < 1) {
				scrollAnimationFrame = requestAnimationFrame(step);
				return;
			}
			scrollAnimationFrame = undefined;
			releaseAnchorUpdateSuppression();
		};

		scrollAnimationFrame = requestAnimationFrame(step);
	};

	const scrollToDate = async (date: Date, behavior: ScrollBehavior = 'auto') => {
		if (!scroller) return;
		await tick();
		const daySection = scroller.querySelector<HTMLElement>(`[data-day-key="${dateKey(date)}"]`);
		if (!daySection) return;
		suppressAnchorUpdate = true;
		const targetLeft =
			scroller.scrollLeft +
			daySection.getBoundingClientRect().left -
			scroller.getBoundingClientRect().left;
		if (snapTimeout) clearTimeout(snapTimeout);
		scrollToLeft(targetLeft, behavior);
	};

	const currentHorizontalAnchor = (): { date: string; offset: number } | undefined => {
		if (!scroller) return;
		const scrollerLeft = scroller.getBoundingClientRect().left;
		const sections = Array.from(scroller.querySelectorAll<HTMLElement>('[data-day-key]'));
		const section =
			sections.find((daySection) => daySection.getBoundingClientRect().right > scrollerLeft + 1) ??
			sections[0];
		const date = section?.dataset.dayKey;
		return date ? { date, offset: section.getBoundingClientRect().left - scrollerLeft } : undefined;
	};

	const restoreHorizontalAnchor = (anchor: { date: string; offset: number }) => {
		if (!scroller) return;
		const section = scroller.querySelector<HTMLElement>(`[data-day-key="${anchor.date}"]`);
		if (!section) return;
		const scrollerLeft = scroller.getBoundingClientRect().left;
		const nextOffset = section.getBoundingClientRect().left - scrollerLeft;
		scroller.scrollLeft += nextOffset - anchor.offset;
	};

	const prependDays = async () => {
		if (!scroller || loadingMoreDays) return;
		loadingMoreDays = true;
		cancelProgrammaticScroll();
		suppressAnchorUpdate = true;
		const anchor = currentHorizontalAnchor();
		const firstDay = days[0];
		days = [
			...Array.from({ length: pageSize }, (_, index) => addDays(firstDay, index - pageSize)),
			...days
		];
		await tick();
		if (anchor) restoreHorizontalAnchor(anchor);
		releaseAnchorUpdateSuppression();
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

	const currentLeftDate = (): Date | undefined => {
		if (!scroller) return;
		const left = scroller.getBoundingClientRect().left;
		const sections = Array.from(scroller.querySelectorAll<HTMLElement>('[data-day-key]'));
		const closest = sections
			.map((section) => ({
				section,
				distance: Math.abs(section.getBoundingClientRect().left - left)
			}))
			.sort(
				(leftSection, rightSection) => leftSection.distance - rightSection.distance
			)[0]?.section;
		const key = closest?.dataset.dayKey;
		return key ? dateFromKey(key) : undefined;
	};

	const loadMoreDays = () => {
		if (!scroller) return;
		const edgeThreshold = Math.max(contentWidth, minDayColumnWidth * 2);
		if (scroller.scrollLeft < edgeThreshold) void prependDays();
		const remaining = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
		if (remaining < edgeThreshold) void appendDays();
	};

	const publishAnchorDate = () => {
		if (suppressAnchorUpdate || draggingScroller || reflowingLayout) return;
		const leftDate = currentLeftDate();
		if (!leftDate) return;
		const key = dateKey(leftDate);
		if (key === lastAnnouncedKey) return;
		lastAnnouncedKey = key;
		lastStartTime = leftDate.getTime();
		onanchordatechange?.(leftDate);
	};

	const scheduleSnapToNearestDay = (delay = scrollSnapIdleMs) => {
		if (draggingScroller || suppressAnchorUpdate || reflowingLayout) return;
		if (snapTimeout) clearTimeout(snapTimeout);
		const inputQuietDelay = Math.max(delay, wheelInputActiveUntil - performance.now());
		snapTimeout = setTimeout(() => {
			snapTimeout = undefined;
			snapToNearestDay();
		}, inputQuietDelay);
	};

	const handleScroll = () => {
		if (!scroller) return;
		const nextScrollLeft = scroller.scrollLeft;
		const nextScrollTop = scroller.scrollTop;
		const horizontalScrollDelta = nextScrollLeft - lastScrollLeft;
		const verticalScrollDelta = nextScrollTop - lastScrollTop;
		const horizontalScrollChanged = Math.abs(horizontalScrollDelta) > 0.5;
		const verticalScrollChanged = Math.abs(verticalScrollDelta) > 0.5;
		if (verticalScrollChanged) {
			lastScrollTop = nextScrollTop;
			lastVerticalScrollTime = performance.now();
		}
		if (!horizontalScrollChanged) return;
		lastScrollLeft = nextScrollLeft;

		loadMoreDays();
		if (scrollFrame === undefined) {
			scrollFrame = requestAnimationFrame(() => {
				scrollFrame = undefined;
				publishAnchorDate();
			});
		}

		if (performance.now() >= wheelInputActiveUntil) scheduleSnapToNearestDay();
	};

	const snapToNearestDay = () => {
		if (draggingScroller) return;
		const leftDate = currentLeftDate();
		if (!leftDate) return;
		lastAnnouncedKey = dateKey(leftDate);
		lastStartTime = leftDate.getTime();
		onanchordatechange?.(leftDate);
		void scrollToDate(leftDate, 'smooth');
	};

	const isDedicatedHorizontalWheel = (event: WheelEvent): boolean =>
		event.deltaX !== 0 && Math.abs(event.deltaY) < 1 && Number.isInteger(event.deltaX);

	const isLikelyDiscreteWheel = (event: WheelEvent, delta: number): boolean =>
		event.shiftKey ||
		event.deltaMode !== 0 ||
		isDedicatedHorizontalWheel(event) ||
		Math.abs(delta) >= 80;

	const isLikelyTouchpadWheel = (event: WheelEvent, delta: number): boolean =>
		event.deltaMode === 0 && !isLikelyDiscreteWheel(event, delta);

	const clearWheelTargetSoon = () => {
		if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
		wheelTargetClearTimeout = setTimeout(() => {
			wheelTargetDate = undefined;
			wheelTargetClearTimeout = undefined;
		}, discreteWheelActiveMs);
	};

	const scrollByWheelStep = async (direction: number) => {
		const leftDate = wheelTargetDate ?? currentLeftDate() ?? anchorDate;
		const nextDate = addDays(leftDate, direction);
		wheelTargetDate = nextDate;
		clearWheelTargetSoon();
		ensureDateLoaded(nextDate);
		lastAnnouncedKey = dateKey(nextDate);
		lastStartTime = nextDate.getTime();
		onanchordatechange?.(nextDate);
		await scrollToDate(nextDate, 'smooth');
	};

	const touchById = (touches: TouchList, id: number): Touch | undefined =>
		Array.from(touches).find((touch) => touch.identifier === id);

	const clearPendingSnap = () => {
		if (!snapTimeout) return;
		clearTimeout(snapTimeout);
		snapTimeout = undefined;
	};

	const clearTouchInput = () => {
		wheelInputActiveUntil = 0;
	};

	const snapAfterTouch = () => {
		clearPendingSnap();
		clearTouchInput();
		suppressAnchorUpdate = false;
		snapToNearestDay();
	};

	const dayColumnWidth = (): number => scroller?.clientWidth / visibleDayCount || minDayColumnWidth;

	const snapTouchDistance = (): number =>
		Math.max(touchMinDistanceSnapPx, dayColumnWidth() * touchDistanceSnapRatio);

	const snapTouchNearestDistance = (): number => dayColumnWidth() * touchNearestSnapRatio;

	const snapToTouchAdjacentDay = (direction: number) => {
		const baseDate = touchStartDate ?? currentLeftDate() ?? anchorDate;
		const nextDate = addDays(baseDate, direction);
		ensureDateLoaded(nextDate);
		lastAnnouncedKey = dateKey(nextDate);
		lastStartTime = nextDate.getTime();
		onanchordatechange?.(nextDate);
		void scrollToDate(nextDate, 'smooth');
	};

	const startInertiaScroll = (
		velocity: number,
		snapVelocityThreshold = touchInertiaSnapVelocityThreshold,
		decay = touchInertiaDecay,
		snapIdleMs = touchSnapIdleMs
	) => {
		if (!scroller) return;
		cancelProgrammaticScroll();
		let lastFrameTime = performance.now();
		let currentVelocity = velocity;
		wheelInputActiveUntil = performance.now() + snapIdleMs;

		const step = (time: number) => {
			if (!scroller) return;
			const elapsed = Math.max(1, time - lastFrameTime);
			lastFrameTime = time;
			scroller.scrollLeft += currentVelocity * elapsed;
			currentVelocity *= Math.pow(decay, elapsed / 16.67);
			wheelInputActiveUntil = performance.now() + snapIdleMs;

			if (Math.abs(currentVelocity) >= snapVelocityThreshold) {
				scrollAnimationFrame = requestAnimationFrame(step);
				return;
			}

			scrollAnimationFrame = undefined;
			snapAfterTouch();
		};

		scrollAnimationFrame = requestAnimationFrame(step);
	};

	const startTouchScroll = (event: TouchEvent) => {
		if (!scroller || event.touches.length !== 1 || draggingMealId) return;
		const now = performance.now();
		clearPendingSnap();
		clearTouchInput();
		cancelProgrammaticScroll();
		suppressAnchorUpdate = false;
		const touch = event.changedTouches[0];
		touchScrollId = touch.identifier;
		touchScrollAxis = undefined;
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchStartScrollLeft = scroller.scrollLeft;
		touchStartDate = currentLeftDate() ?? anchorDate;
		touchTotalX = 0;
		touchStartedDuringVerticalMomentum =
			now - lastVerticalScrollTime < touchVerticalMomentumWindowMs;
		touchLastX = touch.clientX;
		touchLastTime = now;
		touchVelocity = 0;
	};

	const moveTouchScroll = (event: TouchEvent) => {
		if (!scroller || touchScrollId === undefined || draggingMealId || reflowingLayout) return;
		const touch = touchById(event.touches, touchScrollId);
		if (!touch) return;
		const totalX = touch.clientX - touchStartX;
		const totalY = touch.clientY - touchStartY;

		if (!touchScrollAxis) {
			const horizontalDuringVerticalMomentum =
				touchStartedDuringVerticalMomentum &&
				Math.abs(totalX) >= touchVerticalMomentumHorizontalThresholdPx &&
				Math.abs(totalX) >= Math.abs(totalY) * touchVerticalMomentumHorizontalBias;

			if (horizontalDuringVerticalMomentum) {
				touchScrollAxis = 'horizontal';
			} else {
				if (Math.hypot(totalX, totalY) < touchPanThresholdPx) return;
				touchScrollAxis =
					Math.abs(totalX) >= Math.abs(totalY) * touchHorizontalAxisBias
						? 'horizontal'
						: 'vertical';
			}
		}

		if (touchScrollAxis !== 'horizontal') return;

		event.preventDefault();
		clearPendingSnap();
		wheelTargetDate = undefined;
		if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
		wheelTargetClearTimeout = undefined;
		const now = performance.now();
		const delta = touchLastX - touch.clientX;
		const elapsed = Math.max(1, now - touchLastTime);
		touchVelocity = touchVelocity * 0.62 + (delta / elapsed) * 0.38;
		touchTotalX = totalX;
		wheelInputActiveUntil = now + touchSnapIdleMs;
		scroller.scrollLeft = touchStartScrollLeft - totalX;
		touchLastX = touch.clientX;
		touchLastTime = now;
	};

	const stopTouchScroll = (event: TouchEvent) => {
		if (touchScrollId === undefined) return;
		const touchEnded = Boolean(touchById(event.changedTouches, touchScrollId));
		if (!touchEnded) return;
		const wasHorizontal = touchScrollAxis === 'horizontal';
		const releaseVelocity = touchVelocity;
		const releaseDistance = touchTotalX;
		touchScrollId = undefined;
		touchScrollAxis = undefined;
		touchVelocity = 0;
		touchTotalX = 0;
		touchStartedDuringVerticalMomentum = false;
		if (!wasHorizontal || !scroller) return;

		if (Math.abs(releaseVelocity) >= touchVelocityThreshold) {
			startInertiaScroll(releaseVelocity, touchInertiaSnapVelocityThreshold);
			return;
		}

		if (Math.abs(releaseDistance) >= snapTouchNearestDistance()) {
			snapAfterTouch();
			return;
		}

		if (Math.abs(releaseDistance) >= snapTouchDistance()) {
			snapToTouchAdjacentDay(releaseDistance < 0 ? 1 : -1);
			return;
		}

		snapAfterTouch();
	};

	const handleWheel = (event: WheelEvent) => {
		if (!scroller) return;
		const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : 0;
		const shiftWheelDelta = event.shiftKey ? event.deltaY : 0;
		const delta = horizontalDelta || shiftWheelDelta;
		if (!delta) return;

		event.preventDefault();
		event.stopPropagation();
		if (suppressAnchorUpdate) {
			cancelProgrammaticScroll();
			suppressAnchorUpdate = false;
			scroller.scrollTo({ left: scroller.scrollLeft, behavior: 'auto' });
		}
		if (draggingScroller || reflowingLayout) return;
		if (snapTimeout) {
			clearTimeout(snapTimeout);
			snapTimeout = undefined;
		}

		if (isLikelyTouchpadWheel(event, delta)) {
			wheelTargetDate = undefined;
			if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
			wheelTargetClearTimeout = undefined;
			wheelInputActiveUntil = performance.now() + trackpadSnapIdleMs;
			scroller.scrollLeft += delta * trackpadDeltaFriction;
			scheduleSnapToNearestDay(trackpadSnapIdleMs);
			return;
		}

		wheelInputActiveUntil = performance.now() + discreteWheelActiveMs;
		void scrollByWheelStep(delta > 0 ? 1 : -1);
	};

	const startDragScroll = (event: PointerEvent) => {
		if (!scroller || event.pointerType === 'touch' || event.button !== 0) return;
		if (event.target instanceof Element && event.target.closest('[data-meal-card-id]')) return;
		clearPendingSnap();
		clearTouchInput();
		cancelProgrammaticScroll();
		suppressAnchorUpdate = false;
		draggingScroller = true;
		dragStartX = event.clientX;
		dragStartScrollLeft = scroller.scrollLeft;
		dragLastX = event.clientX;
		dragLastTime = performance.now();
		dragVelocity = 0;
		scroller.setPointerCapture(event.pointerId);
		event.preventDefault();
	};

	const dragScroll = (event: PointerEvent) => {
		if (!scroller || !draggingScroller) return;
		const now = performance.now();
		const delta = dragLastX - event.clientX;
		const elapsed = Math.max(1, now - dragLastTime);
		dragVelocity = dragVelocity * 0.62 + (delta / elapsed) * 0.38;
		wheelInputActiveUntil = now + dragSnapIdleMs;
		scroller.scrollLeft = dragStartScrollLeft - (event.clientX - dragStartX);
		dragLastX = event.clientX;
		dragLastTime = now;
		event.preventDefault();
	};

	const stopDragScroll = (event: PointerEvent) => {
		if (!scroller || !draggingScroller) return;
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
		void scrollToDate(anchorDate);
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
		};
	});

	$effect(() => {
		const nextVisibleDayCount = visibleDayCount;
		const nextContentWidth = contentWidth;
		onvisibledaycountchange?.(nextVisibleDayCount);

		if (nextVisibleDayCount !== lastVisibleDayCount) {
			lastVisibleDayCount = nextVisibleDayCount;
		}

		if (nextContentWidth === lastContentWidth || days.length === 0) return;
		lastContentWidth = nextContentWidth;

		reflowingLayout = true;
		if (snapTimeout) {
			clearTimeout(snapTimeout);
			snapTimeout = undefined;
		}
		if (reflowTimeout) clearTimeout(reflowTimeout);

		const stableLeftDate = lastAnnouncedKey ? dateFromKey(lastAnnouncedKey) : anchorDate;
		void scrollToDate(stableLeftDate);
		reflowTimeout = setTimeout(() => {
			reflowingLayout = false;
			void scrollToDate(stableLeftDate);
		}, 180);
	});

	$effect(() => {
		const nextStartTime = anchorDate.getTime();
		const nextDayNavigationSignal = dayNavigationSignal;
		if (nextStartTime === lastStartTime && days.length > 0) return;
		const keyboardNavigation = nextDayNavigationSignal !== lastDayNavigationSignal;
		lastStartTime = nextStartTime;
		lastDayNavigationSignal = nextDayNavigationSignal;
		ensureDateLoaded(anchorDate);
		lastAnnouncedKey = dateKey(anchorDate);
		void scrollToDate(anchorDate, keyboardNavigation ? 'smooth' : 'auto');
	});
</script>

<div
	bind:clientWidth={contentWidth}
	class="@container/multi-day flex h-full min-w-0 flex-col overflow-hidden"
>
	<div class="border-b border-border">
		<MealPool
			{draggingMealId}
			{draggedMeal}
			{dropTarget}
			{onpick}
			{onselect}
			meals={mealPool}
			showImages={showMealPoolImages}
		/>
	</div>
	<div class="border-b border-border px-4 py-1 text-xs font-medium">
		{formatWeekHeading(anchorDate)}
	</div>

	<div
		bind:this={scroller}
		data-drag-secondary-scroll
		role="region"
		aria-label="Multi-day schedule"
		onscroll={handleScroll}
		onpointerdown={startDragScroll}
		onpointermove={dragScroll}
		onpointerup={stopDragScroll}
		onpointercancel={stopDragScroll}
		class="grid min-h-0 flex-1 touch-pan-y [scrollbar-width:none] grid-flow-col overflow-x-auto overflow-y-auto overscroll-x-none [overflow-anchor:none] [&::-webkit-scrollbar]:hidden"
		class:select-none={draggingScroller}
		style="--visible-days: {visibleDayCount}; grid-auto-columns: calc(100% / var(--visible-days));"
	>
		{#each days as day, index (day.toISOString())}
			<MultiDayColumn
				{day}
				{index}
				meals={mealsForDate(day)}
				{draggingScroller}
				{draggingMealId}
				{draggedMeal}
				{dropTarget}
				{onpick}
				{onselect}
			/>
		{/each}
	</div>
</div>

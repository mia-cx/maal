<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import {
		createFastScrollGate,
		createGridSnapper,
		createRetargetableScroll,
		createWheelGestureClassifier,
		startInertiaScroll as startSdkInertiaScroll,
		touchById,
		type ProgrammaticScrollBehavior,
		wheelDeltaPixels
	} from '$lib/interaction/scroll-sdk';
	import { onMount, tick } from 'svelte';
	import {
		addDays,
		dateFromKey,
		dateKey,
		formatWeekHeading,
		isoWeekNumber,
		startOfDay
	} from './schedule-date';
	import ScheduleMealPoolBar from './schedule-meal-pool-bar.svelte';
	import MultiDayColumn from './multi-day-column.svelte';
	import { sortScheduledMeals } from './schedule-ordering';
	import type { Meal, MealCheckInHandler, MealDropTarget } from './schedule-types';

	const pageSize = 21;
	const minDayColumnWidth = 144;
	const trackpadInputActiveMs = 360;
	const trackpadTailSnapIdleMs = 96;
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
		weekStartsOn = 'monday',
		dayNavigationSignal = 0,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onaddmeal,
		onpick,
		onselect,
		oncheckin,
		onanchordatechange,
		onvisibledaycountchange,
		onloadedrangechange
	}: {
		mealPool: Meal[];
		plannedMeals: Meal[];
		showMealPoolImages?: boolean;
		anchorDate: Date;
		weekStartsOn?: 'sunday' | 'monday';
		dayNavigationSignal?: number;
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onaddmeal?: (date?: string) => void;
		onpick?: (meal: Meal, event: PointerEvent) => void;
		onselect?: (meal: Meal) => void;
		oncheckin?: MealCheckInHandler;
		onanchordatechange?: (date: Date) => void;
		onvisibledaycountchange?: (dayCount: number) => void;
		onloadedrangechange?: (range: { start: string; end: string }) => void;
	} = $props();

	let days = $state<Date[]>([]);
	let scroller: HTMLDivElement;
	let contentWidth = $state(0);
	let loadingMoreDays = false;
	let scrollFrame: number | undefined;
	let cancelInertiaScroll: (() => void) | undefined;
	let scrollReleaseTimeout: ReturnType<typeof setTimeout> | undefined;
	let suppressAnchorUpdate = false;
	let draggingScroller = $state(false);
	let pendingDragScrollPointerId: number | null = null;
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
	let directionalWheelSnapUntil = 0;
	let directionalWheelSnapDelay = trackpadInputActiveMs;
	let lastStartTime = $state(0);
	let lastDayNavigationSignal = $state(0);
	let lastContentWidth = $state(0);
	let lastVisibleDayCount = $state(0);
	let lastAnnouncedKey = $state('');
	let lastScrollLeft = 0;
	let lastScrollTop = 0;
	let lastVerticalScrollTime = 0;
	let fastScrollOverlayLabel = $state('');
	let fastScrollOverlayVisible = $state(false);

	const visibleDayCount = $derived(
		Math.min(7, Math.max(1, Math.floor(contentWidth / minDayColumnWidth) || 1))
	);

	const daysAround = (date: Date): Date[] => {
		const start = addDays(startOfDay(date), -pageSize);
		return Array.from({ length: pageSize * 3 }, (_, index) => addDays(start, index));
	};

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
		const key = dateKey(date);
		if (days.some((day) => dateKey(day) === key)) return;
		days = daysAround(date);
	};

	const wheelGesture = createWheelGestureClassifier();

	const fastScrollGate = createFastScrollGate<Date>({
		debugName: 'multi-day',
		label: (date) => `Week ${isoWeekNumber(date)}, ${fastScrollMonthFormatter.format(date)}`,
		onOverlayChange: ({ visible, label }) => {
			fastScrollOverlayVisible = visible;
			fastScrollOverlayLabel = label;
		}
	});

	const releaseAnchorUpdateSuppression = (delay = 80) => {
		if (scrollReleaseTimeout) clearTimeout(scrollReleaseTimeout);
		scrollReleaseTimeout = setTimeout(() => {
			suppressAnchorUpdate = false;
			scrollReleaseTimeout = undefined;
		}, delay);
	};

	const horizontalScroll = createRetargetableScroll({
		axis: 'x',
		getElement: () => scroller,
		onPositionChange: (position) => (lastScrollLeft = position),
		onSettle: () => releaseAnchorUpdateSuppression()
	});

	const cancelProgrammaticScroll = () => {
		horizontalScroll.cancel();
		cancelInertiaScroll?.();
		cancelInertiaScroll = undefined;
		if (scrollReleaseTimeout) clearTimeout(scrollReleaseTimeout);
		scrollReleaseTimeout = undefined;
	};

	const dayGrid = createGridSnapper({
		getElement: () => scroller,
		grid: { x: { selector: '[data-day-key]', dataAttribute: 'dayKey' } },
		scroll: { x: horizontalScroll }
	});

	const scrollToDate = async (
		date: Date,
		behavior: ProgrammaticScrollBehavior = 'auto'
	): Promise<boolean> => {
		if (!scroller) return false;
		await tick();
		suppressAnchorUpdate = true;
		if (snapTimeout) clearTimeout(snapTimeout);
		return dayGrid.scrollToKey('x', dateKey(date), behavior);
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

	const adjustActiveDragStartAfterPrepend = (scrollDelta: number) => {
		if (pendingDragScrollPointerId !== null) dragStartScrollLeft += scrollDelta;
		if (touchScrollId !== undefined) touchStartScrollLeft += scrollDelta;
		lastScrollLeft = scroller?.scrollLeft ?? lastScrollLeft;
	};

	const prependDays = async () => {
		if (!scroller || loadingMoreDays) return;
		loadingMoreDays = true;
		cancelProgrammaticScroll();
		suppressAnchorUpdate = true;
		const previousScrollLeft = scroller.scrollLeft;
		const anchor = currentHorizontalAnchor();
		const firstDay = days[0];
		days = [
			...Array.from({ length: pageSize }, (_, index) => addDays(firstDay, index - pageSize)),
			...days
		];
		await tick();
		if (anchor) restoreHorizontalAnchor(anchor);
		adjustActiveDragStartAfterPrepend(scroller.scrollLeft - previousScrollLeft);
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
		const key = dayGrid.keyAtEdge('x');
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

	const scheduleSnapToNearestDay = (delay = scrollSnapIdleMs, direction = 0) => {
		if (draggingScroller || suppressAnchorUpdate || reflowingLayout) return;
		if (snapTimeout) clearTimeout(snapTimeout);
		const inputQuietDelay = Math.max(delay, wheelInputActiveUntil - performance.now());
		snapTimeout = setTimeout(() => {
			snapTimeout = undefined;
			if (direction) {
				snapToDirectionalDay(Math.sign(direction));
				return;
			}
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
		const now = performance.now();
		if (verticalScrollChanged) {
			lastScrollTop = nextScrollTop;
			lastVerticalScrollTime = now;
		}
		if (!horizontalScrollChanged) return;
		lastScrollLeft = nextScrollLeft;
		const horizontalScrollDirection = Math.sign(horizontalScrollDelta);
		if (horizontalScrollDirection && now <= directionalWheelSnapUntil) {
			directionalWheelSnapUntil = now + directionalWheelSnapDelay;
		}

		loadMoreDays();
		if (scrollFrame === undefined) {
			scrollFrame = requestAnimationFrame(() => {
				scrollFrame = undefined;
				publishAnchorDate();
			});
		}

		scheduleSnapToNearestDay(
			scrollSnapIdleMs,
			performance.now() <= directionalWheelSnapUntil ? horizontalScrollDirection : 0
		);
	};

	const publishDayAndScroll = (date: Date) => {
		lastAnnouncedKey = dateKey(date);
		lastStartTime = date.getTime();
		onanchordatechange?.(date);
		void scrollToDate(date, 'animated');
	};

	const snapToNearestDay = () => {
		if (draggingScroller) return;
		const leftDate = currentLeftDate();
		if (!leftDate) return;
		publishDayAndScroll(leftDate);
	};

	const currentDirectionalDay = (direction: number): Date | undefined => {
		const key = dayGrid.keyAtEdge('x', direction);
		return key ? dateFromKey(key) : currentLeftDate();
	};

	const snapToDirectionalDay = (direction: number) => {
		if (draggingScroller) return;
		const date = currentDirectionalDay(direction);
		if (!date) return;
		publishDayAndScroll(date);
	};

	const clearWheelTargetSoon = () => {
		if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
		wheelTargetClearTimeout = setTimeout(() => {
			wheelTargetDate = undefined;
			wheelTargetClearTimeout = undefined;
		}, discreteWheelActiveMs);
	};

	const scrollByWheelStep = async (direction: number) => {
		const leftDate = wheelTargetDate ?? currentLeftDate() ?? anchorDate;
		const fastTargetDate = addDays(leftDate, direction * visibleDayCount);
		const fastScroll = fastScrollGate.shouldSkipAnimation(direction, fastTargetDate);
		const nextDate = fastScroll ? fastTargetDate : addDays(leftDate, direction);
		const behavior: ProgrammaticScrollBehavior = fastScroll ? 'auto' : 'animated';
		wheelTargetDate = nextDate;
		clearWheelTargetSoon();
		ensureDateLoaded(nextDate);
		lastAnnouncedKey = dateKey(nextDate);
		lastStartTime = nextDate.getTime();
		onanchordatechange?.(nextDate);
		const snapped = await scrollToDate(nextDate, behavior);
		if (!snapped && scroller) {
			scroller.scrollLeft += direction * dayColumnWidth() * (fastScroll ? visibleDayCount : 1);
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
			snapToDirectionalDay(direction);
			return;
		}
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
		void scrollToDate(nextDate, 'animated');
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
			axis: 'x',
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

	const browserNavigationEdgePx = 32;

	const startsInBrowserNavigationEdge = (touch: Touch): boolean =>
		touch.clientX <= browserNavigationEdgePx ||
		(window.innerWidth > 0 && touch.clientX >= window.innerWidth - browserNavigationEdgePx);

	const startTouchScroll = (event: TouchEvent) => {
		if (!scroller || event.touches.length !== 1 || draggingMealId) return;
		const touch = event.changedTouches[0];
		if (startsInBrowserNavigationEdge(touch)) return;
		const now = performance.now();
		clearPendingSnap();
		clearTouchInput();
		cancelProgrammaticScroll();
		suppressAnchorUpdate = false;
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
			snapAfterTouch(releaseDistance < 0 ? 1 : -1);
			return;
		}

		if (Math.abs(releaseDistance) >= snapTouchDistance()) {
			snapToTouchAdjacentDay(releaseDistance < 0 ? 1 : -1);
			return;
		}

		snapAfterTouch();
	};

	const restoreLockedScrollLeft = (lockedScrollLeft: number) => {
		if (!scroller) return;
		scroller.scrollLeft = lockedScrollLeft;
		lastScrollLeft = lockedScrollLeft;
	};

	const handleWheel = (event: WheelEvent) => {
		if (!scroller) return;
		const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : 0;
		const shiftWheelDelta = event.shiftKey ? event.deltaY : 0;
		const delta = horizontalDelta || shiftWheelDelta;
		const wheel = wheelGesture.classify(event);
		if (wheel.kind === 'continuous') {
			if (draggingScroller || reflowingLayout) return;
			clearPendingSnap();
			wheelTargetDate = undefined;
			if (wheelTargetClearTimeout) clearTimeout(wheelTargetClearTimeout);
			wheelTargetClearTimeout = undefined;
			const now = performance.now();
			const snapDelay = wheel.settleSoon ? trackpadTailSnapIdleMs : trackpadInputActiveMs;
			wheelInputActiveUntil = now + snapDelay;
			directionalWheelSnapDelay = snapDelay;
			directionalWheelSnapUntil = now + snapDelay;
			cancelProgrammaticScroll();
			suppressAnchorUpdate = false;
			scheduleSnapToNearestDay(snapDelay, Math.sign(wheel.dominantDelta));
			return;
		}

		if (wheel.kind === 'pending' && delta) return;

		if (!delta) {
			if (!event.deltaY) return;
			const lockedScrollLeft = scroller.scrollLeft;
			event.preventDefault();
			event.stopPropagation();
			scroller.scrollTop += wheelDeltaPixels(scroller, event, event.deltaY);
			restoreLockedScrollLeft(lockedScrollLeft);
			requestAnimationFrame(() => restoreLockedScrollLeft(lockedScrollLeft));
			return;
		}

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
		dragStartX = event.clientX;
		dragStartScrollLeft = scroller.scrollLeft;
		dragLastX = event.clientX;
		dragLastTime = performance.now();
		dragVelocity = 0;
	};

	const dragScroll = (event: PointerEvent) => {
		if (!scroller || pendingDragScrollPointerId !== event.pointerId) return;
		if (!draggingScroller) {
			if (Math.abs(event.clientX - dragStartX) < touchPanThresholdPx) return;
			clearPendingSnap();
			clearTouchInput();
			cancelProgrammaticScroll();
			suppressAnchorUpdate = false;
			draggingScroller = true;
			scroller.setPointerCapture(event.pointerId);
		}
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
		if (!scroller || pendingDragScrollPointerId !== event.pointerId) return;
		pendingDragScrollPointerId = null;
		if (!draggingScroller) return;
		const releaseVelocity = dragVelocity;
		const releaseDistance = scroller.scrollLeft - dragStartScrollLeft;
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
		snapAfterTouch(Math.abs(releaseDistance) > 1 ? Math.sign(releaseDistance) : undefined);
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
			wheelGesture.reset();
			fastScrollGate.destroy();
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
		if (!days.length) return;
		onloadedrangechange?.({ start: dateKey(days[0]), end: dateKey(days.at(-1)!) });
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
		void scrollToDate(anchorDate, keyboardNavigation ? 'animated' : 'auto');
	});
</script>

<div
	bind:clientWidth={contentWidth}
	class="@container/multi-day flex h-full min-w-0 flex-col overflow-hidden"
>
	<ScheduleMealPoolBar
		{draggingMealId}
		{draggedMeal}
		{dropTarget}
		{onaddmeal}
		{onpick}
		{onselect}
		meals={mealPool}
		showImages={showMealPoolImages}
	/>
	<div class="border-b border-border px-4 py-1 text-xs font-medium">
		{formatWeekHeading(anchorDate, new Date(), weekStartsOn)}
	</div>

	<div class="relative min-h-0 flex-1">
		<div
			bind:this={scroller}
			data-drag-secondary-scroll
			role="region"
			aria-label={m.app_multi_day_schedule()}
			onscroll={handleScroll}
			onpointerdown={startDragScroll}
			onpointermove={dragScroll}
			onpointerup={stopDragScroll}
			onpointercancel={stopDragScroll}
			class="grid h-full min-h-0 touch-pan-y [scrollbar-width:none] grid-flow-col overflow-x-auto overflow-y-auto [overflow-anchor:none] [&::-webkit-scrollbar]:hidden"
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
					{onaddmeal}
					{onpick}
					{onselect}
					{oncheckin}
				/>
			{/each}
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

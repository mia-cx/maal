export type ScrollAxis = 'x' | 'y';
export type ProgrammaticScrollBehavior = 'auto' | 'animated';

export type RetargetableScrollOptions = {
	axis: ScrollAxis;
	getElement: () => HTMLElement | undefined | null;
	durationMs?: number;
	settleDistancePx?: number;
	onPositionChange?: (position: number) => void;
	onSettle?: () => void;
};

export const scrollPosition = (element: HTMLElement, axis: ScrollAxis): number =>
	axis === 'x' ? element.scrollLeft : element.scrollTop;

export const setScrollPosition = (element: HTMLElement, axis: ScrollAxis, position: number) => {
	if (axis === 'x') {
		element.scrollLeft = position;
		return;
	}
	element.scrollTop = position;
};

export const scrollElementTo = (
	element: HTMLElement,
	axis: ScrollAxis,
	position: number,
	behavior: ScrollBehavior = 'auto'
) => {
	if (axis === 'x') {
		element.scrollTo({ left: position, behavior });
		return;
	}
	element.scrollTo({ top: position, behavior });
};

export const childOffsetFromScroller = (
	scroller: HTMLElement,
	child: HTMLElement,
	axis: ScrollAxis
): number => {
	const childRect = child.getBoundingClientRect();
	const scrollerRect = scroller.getBoundingClientRect();
	return axis === 'x' ? childRect.left - scrollerRect.left : childRect.top - scrollerRect.top;
};

export const childScrollTarget = (
	scroller: HTMLElement,
	child: HTMLElement,
	axis: ScrollAxis
): number => scrollPosition(scroller, axis) + childOffsetFromScroller(scroller, child, axis);

export const scrollExtent = (element: HTMLElement, axis: ScrollAxis): number =>
	axis === 'x' ? element.scrollWidth : element.scrollHeight;

export const visibleExtent = (element: HTMLElement, axis: ScrollAxis): number =>
	axis === 'x' ? element.clientWidth : element.clientHeight;

export const preservePrependScrollPosition = async (
	scroller: HTMLElement,
	axis: ScrollAxis,
	mutate: () => void,
	afterDomUpdate: () => Promise<void>
) => {
	const previousExtent = scrollExtent(scroller, axis);
	const previousPosition = scrollPosition(scroller, axis);
	mutate();
	await afterDomUpdate();
	setScrollPosition(
		scroller,
		axis,
		previousPosition + (scrollExtent(scroller, axis) - previousExtent)
	);
};

export const createRetargetableScroll = ({
	axis,
	getElement,
	durationMs = 180,
	settleDistancePx = 0.5,
	onPositionChange,
	onSettle
}: RetargetableScrollOptions) => {
	let frame: number | undefined;
	let targetPosition: number | undefined;
	let lastTime = 0;

	const settle = (element: HTMLElement, position: number) => {
		setScrollPosition(element, axis, position);
		onPositionChange?.(position);
		frame = undefined;
		targetPosition = undefined;
		lastTime = 0;
		onSettle?.();
	};

	const step = (time: number) => {
		const element = getElement();
		if (!element || targetPosition === undefined) return;
		const elapsed = lastTime ? Math.max(1, time - lastTime) : 16.67;
		lastTime = time;
		const currentPosition = scrollPosition(element, axis);
		const distance = targetPosition - currentPosition;
		if (Math.abs(distance) < settleDistancePx) {
			settle(element, targetPosition);
			return;
		}

		const progress = 1 - Math.pow(0.001, elapsed / durationMs);
		const nextPosition = currentPosition + distance * progress;
		setScrollPosition(element, axis, nextPosition);
		onPositionChange?.(nextPosition);
		frame = requestAnimationFrame(step);
	};

	const cancel = () => {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
		targetPosition = undefined;
		lastTime = 0;
	};

	const scrollTo = (position: number, behavior: ProgrammaticScrollBehavior = 'auto') => {
		const element = getElement();
		if (!element) return;
		const target = Math.max(0, position);
		if (behavior !== 'animated') {
			cancel();
			scrollElementTo(element, axis, target, 'auto');
			onPositionChange?.(target);
			onSettle?.();
			return;
		}

		targetPosition = target;
		if (frame !== undefined) return;
		lastTime = 0;
		frame = requestAnimationFrame(step);
	};

	return { cancel, scrollTo };
};

export type FastScrollGateOptions<TTarget> = {
	/** Deprecated alias for burstEventGapMs. */
	stepWindowMs?: number;
	/** Deprecated alias for minBurstSteps. */
	minSteps?: number;
	/** Deprecated alias for minScrollEventDurationMs. */
	minDurationMs?: number;
	burstStepWindowMs?: number;
	burstEventGapMs?: number;
	minBurstSteps?: number;
	minScrollEventDurationMs?: number;
	activeGraceMs?: number;
	overlayHoldMs?: number;
	debugName?: string;
	debug?: boolean;
	label: (target: TTarget) => string;
	onOverlayChange: (state: { visible: boolean; label: string }) => void;
};

export type FastScrollDebugEvent = {
	name: string;
	time: number;
	direction: number;
	label: string;
	deltaSinceLastStep: number | null;
	stepsInBurstWindow: number;
	burstDuration: number;
	currentBurstSteps: number;
	burstCountInEvent: number;
	burstDetected: boolean;
	scrollEventDuration: number;
	activeDuringGrace: boolean;
	fastEnough: boolean;
	reason: 'zero-direction' | 'active-grace' | 'gap-reset' | 'warming' | 'threshold-met';
	thresholds: {
		burstStepWindowMs: number;
		burstEventGapMs: number;
		minBurstSteps: number;
		minScrollEventDurationMs: number;
		activeGraceMs: number;
	};
};

export const createFastScrollGate = <TTarget>({
	stepWindowMs,
	minSteps,
	minDurationMs,
	burstStepWindowMs = 50,
	burstEventGapMs = stepWindowMs ?? 350,
	minBurstSteps = minSteps ?? 5,
	minScrollEventDurationMs = minDurationMs ?? 1000,
	activeGraceMs = 2000,
	overlayHoldMs = 2000,
	debugName = 'fast-scroll',
	debug = false,
	label,
	onOverlayChange
}: FastScrollGateOptions<TTarget>) => {
	let lastStepTime = 0;
	let activeUntil = 0;
	let burstDirection = 0;
	let scrollEventStartTime = 0;
	let lastBurstEndTime = 0;
	let burstCountInEvent = 0;
	let currentBurstCounted = false;
	let currentBurstStepTimes: number[] = [];
	let overlayTimeout: ReturnType<typeof setTimeout> | undefined;

	const debugEnabled = (): boolean =>
		debug ||
		(typeof localStorage !== 'undefined' && localStorage.getItem('maal.debug.fastScroll') === '1');

	const debugEvent = (event: FastScrollDebugEvent) => {
		if (!debugEnabled()) return;
		console.debug('[maal fast-scroll]', event);
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent('maal:fast-scroll-debug', { detail: event }));
	};

	const resetWarmupState = () => {
		lastStepTime = 0;
		burstDirection = 0;
		scrollEventStartTime = 0;
		lastBurstEndTime = 0;
		burstCountInEvent = 0;
		currentBurstCounted = false;
		currentBurstStepTimes = [];
	};

	const showOverlay = (target: TTarget) => {
		onOverlayChange({ visible: true, label: label(target) });
		if (overlayTimeout) clearTimeout(overlayTimeout);
		overlayTimeout = setTimeout(() => {
			onOverlayChange({ visible: false, label: label(target) });
			overlayTimeout = undefined;
		}, overlayHoldMs);
	};

	const shouldSkipAnimation = (direction: number, target: TTarget): boolean => {
		const now = performance.now();
		const normalizedDirection = Math.sign(direction);
		const targetLabel = label(target);
		const thresholds = {
			burstStepWindowMs,
			burstEventGapMs,
			minBurstSteps,
			minScrollEventDurationMs,
			activeGraceMs
		};

		const activeDuringGrace = normalizedDirection !== 0 && now <= activeUntil;
		if (
			!activeDuringGrace &&
			burstDirection !== 0 &&
			normalizedDirection !== 0 &&
			normalizedDirection !== burstDirection
		) {
			resetWarmupState();
		}

		const deltaSinceLastStep = lastStepTime ? now - lastStepTime : null;
		const currentBurstDuration =
			currentBurstStepTimes.length > 1
				? currentBurstStepTimes.at(-1)! - currentBurstStepTimes[0]!
				: 0;
		const currentScrollEventDuration = scrollEventStartTime ? now - scrollEventStartTime : 0;

		if (!normalizedDirection) {
			debugEvent({
				name: debugName,
				time: now,
				direction: 0,
				label: targetLabel,
				deltaSinceLastStep,
				stepsInBurstWindow: currentBurstStepTimes.length,
				burstDuration: currentBurstDuration,
				currentBurstSteps: currentBurstStepTimes.length,
				burstCountInEvent,
				burstDetected: false,
				scrollEventDuration: currentScrollEventDuration,
				activeDuringGrace: false,
				fastEnough: false,
				reason: 'zero-direction',
				thresholds
			});
			return false;
		}

		if (activeDuringGrace) {
			lastStepTime = now;
			activeUntil = now + activeGraceMs;
			burstDirection = normalizedDirection;
			showOverlay(target);
			debugEvent({
				name: debugName,
				time: now,
				direction: normalizedDirection,
				label: targetLabel,
				deltaSinceLastStep,
				stepsInBurstWindow: currentBurstStepTimes.length,
				burstDuration: currentBurstDuration,
				currentBurstSteps: currentBurstStepTimes.length,
				burstCountInEvent,
				burstDetected: false,
				scrollEventDuration: currentScrollEventDuration,
				activeDuringGrace,
				fastEnough: true,
				reason: 'active-grace',
				thresholds
			});
			return true;
		}

		const startsNewBurst = deltaSinceLastStep === null || deltaSinceLastStep >= burstStepWindowMs;
		if (startsNewBurst) {
			burstDirection = normalizedDirection;
			currentBurstStepTimes = [now];
			currentBurstCounted = false;
			if (lastBurstEndTime && now - lastBurstEndTime >= burstEventGapMs) {
				scrollEventStartTime = 0;
				lastBurstEndTime = 0;
				burstCountInEvent = 0;
				activeUntil = 0;
			}
		} else {
			burstDirection = normalizedDirection;
			currentBurstStepTimes = [...currentBurstStepTimes, now];
		}
		lastStepTime = now;

		let burstDetected = false;
		if (!currentBurstCounted && currentBurstStepTimes.length >= minBurstSteps) {
			const burstStartTime = currentBurstStepTimes[0]!;
			const continuesScrollEvent =
				lastBurstEndTime > 0 && burstStartTime - lastBurstEndTime < burstEventGapMs;
			if (!continuesScrollEvent) {
				scrollEventStartTime = burstStartTime;
				burstCountInEvent = 0;
			}
			burstCountInEvent += 1;
			currentBurstCounted = true;
			burstDetected = true;
		}
		if (currentBurstCounted) lastBurstEndTime = now;

		const burstDuration = currentBurstStepTimes.at(-1)! - currentBurstStepTimes[0]!;
		const scrollEventDuration = scrollEventStartTime ? now - scrollEventStartTime : 0;
		const fastEnough = currentBurstCounted && scrollEventDuration > minScrollEventDurationMs;
		if (fastEnough) {
			activeUntil = now + activeGraceMs;
			showOverlay(target);
		}
		debugEvent({
			name: debugName,
			time: now,
			direction: normalizedDirection,
			label: targetLabel,
			deltaSinceLastStep,
			stepsInBurstWindow: currentBurstStepTimes.length,
			burstDuration,
			currentBurstSteps: currentBurstStepTimes.length,
			burstCountInEvent,
			burstDetected,
			scrollEventDuration,
			activeDuringGrace,
			fastEnough,
			reason: fastEnough ? 'threshold-met' : startsNewBurst ? 'gap-reset' : 'warming',
			thresholds
		});
		return fastEnough;
	};

	const destroy = () => {
		if (overlayTimeout) clearTimeout(overlayTimeout);
		overlayTimeout = undefined;
	};

	return { shouldSkipAnimation, destroy };
};

export type InertiaScrollOptions = {
	axis: ScrollAxis;
	getElement: () => HTMLElement | undefined | null;
	velocity: number;
	snapVelocityThreshold: number;
	decay: number;
	onActive?: () => void;
	onSettle: () => void;
};

export const startInertiaScroll = ({
	axis,
	getElement,
	velocity,
	snapVelocityThreshold,
	decay,
	onActive,
	onSettle
}: InertiaScrollOptions): (() => void) => {
	let frame: number | undefined;
	let lastFrameTime = performance.now();
	let currentVelocity = velocity;

	const step = (time: number) => {
		const element = getElement();
		if (!element) return;
		const elapsed = Math.max(1, time - lastFrameTime);
		lastFrameTime = time;
		setScrollPosition(element, axis, scrollPosition(element, axis) + currentVelocity * elapsed);
		currentVelocity *= Math.pow(decay, elapsed / 16.67);
		onActive?.();

		if (Math.abs(currentVelocity) >= snapVelocityThreshold) {
			frame = requestAnimationFrame(step);
			return;
		}

		frame = undefined;
		onSettle();
	};

	frame = requestAnimationFrame(step);
	return () => {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
	};
};

export const touchById = (touches: TouchList, id: number): Touch | undefined =>
	Array.from(touches).find((touch) => touch.identifier === id);

export const wheelDeltaPixels = (
	element: HTMLElement,
	event: WheelEvent,
	delta: number
): number => {
	if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
	if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * element.clientHeight;
	return delta;
};

export type WheelGestureKind = 'pending' | 'continuous' | 'discrete';

export type WheelGestureClassification = {
	kind: WheelGestureKind;
	reason:
		| 'line-or-page-mode'
		| 'shift-wheel'
		| 'tiny-start-delta'
		| 'discrete-ramp'
		| 'continuous-window'
		| 'default-continuous'
		| 'collecting';
	events: number;
	started: boolean;
	dominantAxis: ScrollAxis;
	dominantDelta: number;
	absDelta: number;
	settleSoon: boolean;
};

export type WheelGestureClassifierOptions = {
	gestureGapMs?: number;
	continuousGestureGapMs?: number;
	windowSize?: number;
	tinyStartDeltaPx?: number;
	tinyDeltaPx?: number;
	smallDeltaPx?: number;
	discreteWindowSize?: number;
	discreteSumPx?: number;
	discreteMedianPx?: number;
	discreteMaxPx?: number;
	continuousMedianPx?: number;
	continuousTinyRatio?: number;
	continuousCrossAxisRatio?: number;
	earlyTinyEventCount?: number;
	settleWindowSize?: number;
	settleDeltaPx?: number;
	settleMedianDeltaPx?: number;
	settleTrendTolerancePx?: number;
};

type WheelGestureSample = {
	absDominantDelta: number;
	absCrossAxisDelta: number;
};

const median = (values: number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

const wheelDominantAxis = (event: WheelEvent): ScrollAxis =>
	Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? 'x' : 'y';

export const wheelDominantDelta = (event: WheelEvent): number =>
	wheelDominantAxis(event) === 'x' ? event.deltaX : event.deltaY;

const hasTinyNonZeroWheelDelta = (event: WheelEvent, threshold: number): boolean =>
	[event.deltaX, event.deltaY].some((delta) => Math.abs(delta) > 0 && Math.abs(delta) < threshold);

export const createWheelGestureClassifier = ({
	gestureGapMs = 180,
	continuousGestureGapMs = 520,
	windowSize = 5,
	tinyStartDeltaPx = 1,
	tinyDeltaPx = 4,
	discreteWindowSize = 3,
	discreteSumPx = 96,
	discreteMedianPx = 20,
	discreteMaxPx = 64,
	continuousMedianPx = 12,
	continuousTinyRatio = 0.4,
	continuousCrossAxisRatio = 0.15,
	earlyTinyEventCount = 3,
	settleWindowSize = 4,
	settleDeltaPx = 4,
	settleMedianDeltaPx = 6,
	settleTrendTolerancePx = 0.8
}: WheelGestureClassifierOptions = {}) => {
	let kind: WheelGestureKind = 'pending';
	let sampleWindow: WheelGestureSample[] = [];
	let lastEventTime = 0;
	let events = 0;
	let gestureAxis: ScrollAxis | undefined;
	let gestureDirection = 0;

	const reset = () => {
		kind = 'pending';
		sampleWindow = [];
		lastEventTime = 0;
		events = 0;
		gestureAxis = undefined;
		gestureDirection = 0;
	};

	const classifyWindow = (): WheelGestureClassification['reason'] => {
		const dominantDeltas = sampleWindow.map((sample) => sample.absDominantDelta);
		const dominantSum = dominantDeltas.reduce((total, value) => total + value, 0);
		const dominantMedian = median(dominantDeltas);
		const dominantMax = Math.max(...dominantDeltas);
		const crossSum = sampleWindow.reduce((total, sample) => total + sample.absCrossAxisDelta, 0);
		const crossRatio = dominantSum > 0 ? crossSum / dominantSum : 0;
		const tinyRatio =
			dominantDeltas.filter((delta) => delta <= tinyDeltaPx).length / dominantDeltas.length;

		if (
			sampleWindow.length >= discreteWindowSize &&
			dominantSum >= discreteSumPx &&
			dominantMedian >= discreteMedianPx &&
			dominantMax >= discreteMaxPx
		) {
			kind = 'discrete';
			return 'discrete-ramp';
		}

		if (
			sampleWindow.length >= windowSize &&
			(dominantMedian <= continuousMedianPx ||
				tinyRatio >= continuousTinyRatio ||
				crossRatio >= continuousCrossAxisRatio)
		) {
			kind = 'continuous';
			return 'continuous-window';
		}

		if (sampleWindow.length >= windowSize) {
			kind = 'continuous';
			return 'default-continuous';
		}

		return 'collecting';
	};

	const shouldSettleSoon = (): boolean => {
		if (kind !== 'continuous' || sampleWindow.length === 0) return false;
		const tail = sampleWindow.slice(-settleWindowSize).map((sample) => sample.absDominantDelta);
		const latest = tail.at(-1)!;
		const tailMedian = median(tail);
		const decaying = tail.every(
			(delta, index) => index === 0 || delta <= tail[index - 1]! + settleTrendTolerancePx
		);
		return (
			latest <= settleDeltaPx ||
			(tail.length >= settleWindowSize && decaying && tailMedian <= settleMedianDeltaPx)
		);
	};

	const classify = (event: WheelEvent): WheelGestureClassification => {
		const now = performance.now();
		const dominantAxis = wheelDominantAxis(event);
		const dominantDelta = dominantAxis === 'x' ? event.deltaX : event.deltaY;
		const crossAxisDelta = dominantAxis === 'x' ? event.deltaY : event.deltaX;
		const absDelta = Math.abs(dominantDelta);
		const normalizedDirection = Math.sign(dominantDelta);
		const activeGestureGapMs = kind === 'continuous' ? continuousGestureGapMs : gestureGapMs;
		let started = !lastEventTime || now - lastEventTime > activeGestureGapMs;
		const switchedVector =
			!started &&
			normalizedDirection !== 0 &&
			gestureAxis !== undefined &&
			(dominantAxis !== gestureAxis || normalizedDirection !== gestureDirection);

		if (started || switchedVector) {
			kind = 'pending';
			sampleWindow = [];
			events = 0;
			gestureAxis = undefined;
			gestureDirection = 0;
			started = true;
		}

		lastEventTime = now;
		events += 1;
		if (normalizedDirection !== 0) {
			gestureAxis = dominantAxis;
			gestureDirection = normalizedDirection;
		}
		const classification = (reason: WheelGestureClassification['reason']) => ({
			kind,
			reason,
			events,
			started,
			dominantAxis,
			dominantDelta,
			absDelta,
			settleSoon: shouldSettleSoon()
		});

		sampleWindow = [
			...sampleWindow,
			{ absDominantDelta: absDelta, absCrossAxisDelta: Math.abs(crossAxisDelta) }
		].slice(-Math.max(windowSize, settleWindowSize));

		if (kind !== 'pending')
			return classification(kind === 'continuous' ? 'continuous-window' : 'discrete-ramp');

		if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
			kind = 'discrete';
			return classification('line-or-page-mode');
		}

		if (event.shiftKey) {
			kind = 'discrete';
			return classification('shift-wheel');
		}

		if (absDelta >= discreteMaxPx) {
			kind = 'discrete';
			return classification('discrete-ramp');
		}

		if (events <= earlyTinyEventCount && hasTinyNonZeroWheelDelta(event, tinyStartDeltaPx)) {
			kind = 'continuous';
			return classification('tiny-start-delta');
		}

		return classification(classifyWindow());
	};

	return { classify, reset };
};

export const isDedicatedHorizontalWheel = (event: WheelEvent): boolean =>
	event.deltaX !== 0 && Math.abs(event.deltaY) < 1 && Math.abs(event.deltaX) >= 80;

export const isLikelyDiscreteWheel = (event: WheelEvent, delta: number): boolean =>
	event.shiftKey ||
	event.deltaMode !== 0 ||
	isDedicatedHorizontalWheel(event) ||
	Math.abs(delta) >= 80;

export const isLikelyTouchpadWheel = (event: WheelEvent, delta: number): boolean =>
	event.deltaMode === 0 && !isLikelyDiscreteWheel(event, delta);

export const isInteractiveScrollTarget = (target: EventTarget | null): boolean =>
	target instanceof Element &&
	Boolean(
		target.closest(
			'button, a, input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [data-meal-card-id]'
		)
	);

export type GridSnapAxisConfig = {
	selector: string;
	dataAttribute: string;
};

export type GridSnapConfig = Partial<Record<ScrollAxis, GridSnapAxisConfig>>;

export type GridSnapCandidate = {
	element: HTMLElement;
	key: string;
	offset: number;
};

const dataAttributeName = (dataAttribute: string): string =>
	`data-${dataAttribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

const dataValue = (element: HTMLElement, dataAttribute: string): string =>
	element.getAttribute(dataAttributeName(dataAttribute)) ?? element.dataset[dataAttribute] ?? '';

export const gridSnapCandidates = ({
	scroller,
	selector,
	dataAttribute,
	axis,
	direction = 0
}: {
	scroller: HTMLElement;
	selector: string;
	dataAttribute: string;
	axis: ScrollAxis;
	direction?: number;
}): GridSnapCandidate[] =>
	Array.from(scroller.querySelectorAll<HTMLElement>(selector))
		.map((element) => ({
			element,
			key: dataValue(element, dataAttribute),
			offset: childOffsetFromScroller(scroller, element, axis)
		}))
		.filter(({ key, offset }) => {
			if (!key) return false;
			if (!direction) return true;
			return direction > 0 ? offset > 1 : offset < -1;
		})
		.sort((left, right) => {
			if (direction > 0) return left.offset - right.offset;
			if (direction < 0) return right.offset - left.offset;
			return Math.abs(left.offset) - Math.abs(right.offset);
		});

export const gridSnapKeyAtViewportEdge = ({
	scroller,
	axis,
	config,
	direction = 0
}: {
	scroller: HTMLElement;
	axis: ScrollAxis;
	config: GridSnapAxisConfig;
	direction?: number;
}): string | undefined =>
	gridSnapCandidates({ scroller, axis, direction, ...config })[0]?.key ??
	(direction ? gridSnapCandidates({ scroller, axis, ...config })[0]?.key : undefined);

export const gridSnapTargetForKey = ({
	scroller,
	axis,
	config,
	key
}: {
	scroller: HTMLElement;
	axis: ScrollAxis;
	config: GridSnapAxisConfig;
	key: string;
}): number | undefined => {
	const element = Array.from(scroller.querySelectorAll<HTMLElement>(config.selector)).find(
		(candidate) => dataValue(candidate, config.dataAttribute) === key
	);
	return element ? childScrollTarget(scroller, element, axis) : undefined;
};

export const createGridSnapper = ({
	getElement,
	grid,
	scroll
}: {
	getElement: () => HTMLElement | undefined | null;
	grid: GridSnapConfig;
	scroll: Partial<Record<ScrollAxis, ReturnType<typeof createRetargetableScroll>>>;
}) => {
	const keyAtEdge = (axis: ScrollAxis, direction = 0): string | undefined => {
		const scroller = getElement();
		const config = grid[axis];
		if (!scroller || !config) return;
		return gridSnapKeyAtViewportEdge({ scroller, axis, config, direction });
	};

	const scrollToKey = (
		axis: ScrollAxis,
		key: string,
		behavior: ProgrammaticScrollBehavior
	): boolean => {
		const scroller = getElement();
		const config = grid[axis];
		const controller = scroll[axis];
		if (!scroller || !config || !controller) return false;
		const target = gridSnapTargetForKey({ scroller, axis, config, key });
		if (target === undefined) return false;
		controller.scrollTo(target, behavior);
		return true;
	};

	return { keyAtEdge, scrollToKey };
};

export const dataKeyAtViewportEdge = ({
	scroller,
	selector,
	dataAttribute,
	axis,
	direction = 0
}: {
	scroller: HTMLElement;
	selector: string;
	dataAttribute: string;
	axis: ScrollAxis;
	direction?: number;
}): string | undefined =>
	gridSnapKeyAtViewportEdge({
		scroller,
		axis,
		direction,
		config: { selector, dataAttribute }
	});

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	childScrollTarget,
	createFastScrollGate,
	createGridSnapper,
	createRetargetableScroll,
	createWheelGestureClassifier,
	gridSnapCandidates,
	preservePrependScrollPosition,
	scrollExtent,
	scrollPosition,
	setScrollPosition,
	startInertiaScroll,
	visibleExtent,
	wheelDeltaPixels
} from '$lib/interaction/scroll-sdk.js';

type MutableScroller = HTMLElement & {
	clientHeight: number;
	clientWidth: number;
	scrollHeight: number;
	scrollLeft: number;
	scrollTop: number;
	scrollWidth: number;
};

const scroller = (overrides: Partial<MutableScroller> = {}): MutableScroller =>
	({
		clientHeight: 200,
		clientWidth: 300,
		scrollHeight: 800,
		scrollLeft: 0,
		scrollTop: 0,
		scrollWidth: 900,
		scrollTo(options: ScrollToOptions) {
			if (options.left !== undefined) this.scrollLeft = options.left;
			if (options.top !== undefined) this.scrollTop = options.top;
		},
		...overrides
	}) as MutableScroller;

const wheelEvent = ({
	deltaX = 0,
	deltaY = 0,
	deltaMode = 0,
	shiftKey = false
}: {
	deltaX?: number;
	deltaY?: number;
	deltaMode?: number;
	shiftKey?: boolean;
}): WheelEvent => ({ deltaX, deltaY, deltaMode, shiftKey }) as WheelEvent;

const installWheelEventConstants = () => {
	vi.stubGlobal(
		'WheelEvent',
		class {
			static readonly DOM_DELTA_PIXEL = 0;
			static readonly DOM_DELTA_LINE = 1;
			static readonly DOM_DELTA_PAGE = 2;
		}
	);
};

const installAnimationFrames = () => {
	let nextId = 1;
	const frames = new Map<number, FrameRequestCallback>();
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		const id = nextId++;
		frames.set(id, callback);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => {
		frames.delete(id);
	});
	return {
		flush(time: number) {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const callback of callbacks) callback(time);
		},
		get pending() {
			return frames.size;
		}
	};
};

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('axis-neutral geometry', () => {
	test('reads and writes positions and extents on either axis', () => {
		const element = scroller({ scrollLeft: 25, scrollTop: 40 });

		expect(scrollPosition(element, 'x')).toBe(25);
		expect(scrollPosition(element, 'y')).toBe(40);
		expect(scrollExtent(element, 'x')).toBe(900);
		expect(scrollExtent(element, 'y')).toBe(800);
		expect(visibleExtent(element, 'x')).toBe(300);
		expect(visibleExtent(element, 'y')).toBe(200);

		setScrollPosition(element, 'x', 55);
		setScrollPosition(element, 'y', 70);
		expect({ left: element.scrollLeft, top: element.scrollTop }).toEqual({ left: 55, top: 70 });
	});

	test('preserves the visible anchor after prepending content', async () => {
		const element = scroller({ scrollTop: 80, scrollHeight: 600 });

		await preservePrependScrollPosition(
			element,
			'y',
			() => {
				element.scrollHeight = 780;
			},
			async () => Promise.resolve()
		);

		expect(element.scrollTop).toBe(260);
	});
});

describe('retargetable scrolling and inertia', () => {
	test('retargets one active animation and settles on the latest target', () => {
		const frames = installAnimationFrames();
		const element = scroller();
		const settled = vi.fn();
		const controller = createRetargetableScroll({
			axis: 'x',
			getElement: () => element,
			durationMs: 20,
			settleDistancePx: 0.1,
			onSettle: settled
		});

		controller.scrollTo(120, 'animated');
		frames.flush(16);
		controller.scrollTo(48, 'animated');
		for (let time = 32; frames.pending > 0 && time < 500; time += 16) frames.flush(time);

		expect(element.scrollLeft).toBe(48);
		expect(settled).toHaveBeenCalledTimes(1);
	});

	test('decays inertia until the snap threshold and can be cancelled', () => {
		const frames = installAnimationFrames();
		const element = scroller();
		const settled = vi.fn();
		const cancel = startInertiaScroll({
			axis: 'y',
			getElement: () => element,
			velocity: 1,
			snapVelocityThreshold: 0.2,
			decay: 0.5,
			onSettle: settled
		});

		for (let time = 16; frames.pending > 0 && time < 500; time += 16) frames.flush(time);
		expect(element.scrollTop).toBeGreaterThan(0);
		expect(settled).toHaveBeenCalledTimes(1);

		cancel();
		expect(frames.pending).toBe(0);
	});
});

describe('wheel gesture behavior', () => {
	test('normalizes pixel, line, and page deltas', () => {
		installWheelEventConstants();
		const element = scroller({ clientHeight: 240 });

		expect(wheelDeltaPixels(element, wheelEvent({ deltaMode: 0 }), 3)).toBe(3);
		expect(wheelDeltaPixels(element, wheelEvent({ deltaMode: 1 }), 3)).toBe(48);
		expect(wheelDeltaPixels(element, wheelEvent({ deltaMode: 2 }), 3)).toBe(720);
	});

	test('separates discrete wheel ramps from continuous trackpad starts', () => {
		installWheelEventConstants();
		const discrete = createWheelGestureClassifier();
		const continuous = createWheelGestureClassifier();

		expect(discrete.classify(wheelEvent({ deltaY: 120 })).kind).toBe('discrete');
		expect(continuous.classify(wheelEvent({ deltaY: 0.5 })).kind).toBe('continuous');
	});

	test('marks a decaying continuous tail as ready to settle', () => {
		installWheelEventConstants();
		let now = 100;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		const classifier = createWheelGestureClassifier({
			windowSize: 3,
			earlyTinyEventCount: 0,
			continuousMedianPx: 8
		});
		let result = classifier.classify(wheelEvent({ deltaY: 8 }));
		for (const delta of [6, 3, 2]) {
			now += 10;
			result = classifier.classify(wheelEvent({ deltaY: delta }));
		}

		expect(result.kind).toBe('continuous');
		expect(result.settleSoon).toBe(true);
	});
});

describe('fast-scroll and grid snapping', () => {
	test('activates after a sustained burst and holds the overlay through grace', () => {
		vi.useFakeTimers();
		let now = 100;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		const overlays: Array<{ visible: boolean; label: string }> = [];
		const gate = createFastScrollGate({
			burstStepWindowMs: 50,
			minBurstSteps: 2,
			minScrollEventDurationMs: 0,
			activeGraceMs: 100,
			overlayHoldMs: 200,
			label: (target: string) => target,
			onOverlayChange: (overlay) => overlays.push(overlay)
		});

		expect(gate.shouldSkipAnimation(1, 'September')).toBe(false);
		now += 10;
		expect(gate.shouldSkipAnimation(1, 'September')).toBe(true);
		now += 50;
		expect(gate.shouldSkipAnimation(1, 'October')).toBe(true);
		expect(overlays.at(-1)).toEqual({ visible: true, label: 'October' });

		vi.advanceTimersByTime(200);
		expect(overlays.at(-1)).toEqual({ visible: false, label: 'October' });
		gate.destroy();
	});

	test('finds directional candidates and scrolls to a data-key target', () => {
		const element = scroller({ scrollLeft: 100 });
		Object.assign(element, {
			getBoundingClientRect: () => ({ left: 20, top: 0 }),
			querySelectorAll: () => [
				{
					dataset: { date: '2026-08-21' },
					getAttribute: () => '2026-08-21',
					getBoundingClientRect: () => ({ left: 10, top: 0 })
				},
				{
					dataset: { date: '2026-08-22' },
					getAttribute: () => '2026-08-22',
					getBoundingClientRect: () => ({ left: 180, top: 0 })
				}
			]
		});
		const candidates = gridSnapCandidates({
			scroller: element,
			selector: '[data-date]',
			dataAttribute: 'date',
			axis: 'x',
			direction: 1
		});
		const scrollTo = vi.fn();
		const snapper = createGridSnapper({
			getElement: () => element,
			grid: { x: { selector: '[data-date]', dataAttribute: 'date' } },
			scroll: { x: { scrollTo, cancel: vi.fn() } }
		});

		expect(candidates.map(({ key }) => key)).toEqual(['2026-08-22']);
		expect(childScrollTarget(element, candidates[0]!.element, 'x')).toBe(260);
		expect(snapper.scrollToKey('x', '2026-08-22', 'animated')).toBe(true);
		expect(scrollTo).toHaveBeenCalledWith(260, 'animated');
	});
});

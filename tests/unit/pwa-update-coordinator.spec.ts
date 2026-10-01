import { describe, expect, test, vi } from 'vitest';

import {
	PwaUpdateCoordinator,
	type PwaUpdateRuntime,
	type PwaUpdateState,
	type PwaUpdateTimers
} from '$lib/client/pwa/update-coordinator.js';

class FakeChannelHub {
	channels = new Set<FakeChannel>();

	create(): FakeChannel {
		const channel = new FakeChannel(this);
		this.channels.add(channel);
		return channel;
	}
}

class FakeChannel {
	listener: ((event: { data: unknown }) => void) | null = null;
	closeCount = 0;

	constructor(private readonly hub: FakeChannelHub) {}

	addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
		this.listener = listener;
	}

	postMessage(message: unknown): void {
		for (const channel of this.hub.channels) {
			if (channel !== this) channel.listener?.({ data: structuredClone(message) });
		}
	}

	close(): void {
		this.closeCount += 1;
		this.hub.channels.delete(this);
	}
}

class FakeWorker {
	readonly scriptURL = 'https://maal.test/service-worker.js';
	readonly state = 'installed';
	messages: unknown[] = [];

	postMessage(message: unknown): void {
		this.messages.push(message);
	}

	addEventListener(): void {}
	removeEventListener(): void {}
}

class FakeServiceWorkers {
	readonly controller = {};
	listeners = new Map<string, Set<(event: { data: unknown }) => void>>();

	constructor(readonly ready: Promise<FakeRegistration>) {}

	addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	listenerCount(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}

	emitMessage(data: unknown): void {
		for (const listener of this.listeners.get('message') ?? []) listener({ data });
	}

	emitControllerChange(): void {
		for (const listener of this.listeners.get('controllerchange') ?? []) listener({ data: null });
	}
}

class FakeRegistration {
	readonly installing = null;
	listeners = new Set<() => void>();
	constructor(readonly waiting: FakeWorker) {}
	addEventListener(_type: 'updatefound', listener: () => void): void {
		this.listeners.add(listener);
	}
	removeEventListener(_type: 'updatefound', listener: () => void): void {
		this.listeners.delete(listener);
	}
}

class ReceiverSensitiveTimers implements PwaUpdateTimers {
	intervals = new Set<ReturnType<typeof setInterval>>();
	timeouts = new Set<ReturnType<typeof setTimeout>>();
	intervalStarts = 0;
	intervalClears = 0;
	timeoutStarts = 0;
	timeoutClears = 0;
	#nextHandle = 1;

	setInterval(this: ReceiverSensitiveTimers): ReturnType<typeof setInterval> {
		this.#assertReceiver();
		this.intervalStarts += 1;
		const handle = this.#nextHandle++ as unknown as ReturnType<typeof setInterval>;
		this.intervals.add(handle);
		return handle;
	}

	clearInterval(this: ReceiverSensitiveTimers, handle: ReturnType<typeof setInterval>): void {
		this.#assertReceiver();
		this.intervalClears += 1;
		this.intervals.delete(handle);
	}

	setTimeout(this: ReceiverSensitiveTimers): ReturnType<typeof setTimeout> {
		this.#assertReceiver();
		this.timeoutStarts += 1;
		const handle = this.#nextHandle++ as unknown as ReturnType<typeof setTimeout>;
		this.timeouts.add(handle);
		return handle;
	}

	clearTimeout(this: ReceiverSensitiveTimers, handle: ReturnType<typeof setTimeout>): void {
		this.#assertReceiver();
		this.timeoutClears += 1;
		this.timeouts.delete(handle);
	}

	#assertReceiver(): void {
		if (!(this instanceof ReceiverSensitiveTimers)) throw new TypeError('Illegal invocation');
	}
}

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
};

const runtimeFor = (
	serviceWorker: FakeServiceWorkers,
	timers: PwaUpdateTimers,
	overrides: Partial<PwaUpdateRuntime> = {}
): PwaUpdateRuntime => ({
	serviceWorker,
	createChannel: () => new FakeChannelHub().create(),
	createId: () => 'tab-id',
	now: Date.now,
	timers,
	pauseCommits: () => undefined,
	resumeCommits: () => undefined,
	drainCommits: async () => undefined,
	reload: () => undefined,
	...overrides
});

/** Tabs that share one channel and one waiting worker, on the global (fakeable) timers. */
class UpdateTabs {
	readonly hub = new FakeChannelHub();
	readonly waiting = new FakeWorker();
	readonly registration = new FakeRegistration(this.waiting);
	#nextId = 0;

	open(drainCommits: () => Promise<void> = async () => undefined) {
		const serviceWorkers = new FakeServiceWorkers(Promise.resolve(this.registration));
		const paused: string[] = [];
		const resumed: string[] = [];
		const coordinator = new PwaUpdateCoordinator({
			serviceWorker: serviceWorkers,
			createChannel: () => this.hub.create(),
			createId: () => `id-${++this.#nextId}`,
			now: () => Date.now(),
			timers: {
				setInterval: (callback, delay) => setInterval(callback, delay),
				clearInterval: (handle) => clearInterval(handle),
				setTimeout: (callback, delay) => setTimeout(callback, delay),
				clearTimeout: (handle) => clearTimeout(handle)
			},
			pauseCommits: (reason) => paused.push(reason),
			resumeCommits: (reason) => resumed.push(reason),
			drainCommits,
			reload: () => undefined
		});
		let state: PwaUpdateState | null = null;
		coordinator.subscribe((next) => (state = next));
		return { coordinator, serviceWorkers, paused, resumed, status: () => state?.status };
	}
}

describe('PWA update coordination', () => {
	test('does not activate until every live tab has drained its local commits', async () => {
		const hub = new FakeChannelHub();
		const waiting = new FakeWorker();
		const registration = new FakeRegistration(waiting);
		const firstServiceWorkers = new FakeServiceWorkers(Promise.resolve(registration));
		const secondServiceWorkers = new FakeServiceWorkers(Promise.resolve(registration));
		const secondDrain = deferred();
		const paused: string[] = [];
		const resumed: string[] = [];
		const reload = vi.fn();
		let nextId = 0;
		const runtime = (
			serviceWorker: FakeServiceWorkers,
			drainCommits: () => Promise<void>
		): PwaUpdateRuntime => ({
			serviceWorker,
			createChannel: () => hub.create(),
			createId: () => `id-${++nextId}`,
			now: Date.now,
			timers: {
				setInterval: (() => 1) as unknown as typeof setInterval,
				clearInterval: (() => undefined) as unknown as typeof clearInterval,
				setTimeout,
				clearTimeout
			},
			pauseCommits: (reason) => paused.push(reason),
			resumeCommits: (reason) => resumed.push(reason),
			drainCommits,
			reload
		});
		const first = new PwaUpdateCoordinator(runtime(firstServiceWorkers, async () => undefined));
		const second = new PwaUpdateCoordinator(
			runtime(secondServiceWorkers, () => secondDrain.promise)
		);

		await Promise.all([first.start(), second.start()]);
		firstServiceWorkers.emitControllerChange();
		expect(reload).not.toHaveBeenCalled();
		firstServiceWorkers.emitMessage({
			type: 'UPDATE_WAITING',
			version: 'build-2',
			critical: false
		});
		await first.activate();
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(waiting.messages).not.toContainEqual({ type: 'SKIP_WAITING', version: 'build-2' });
		expect(paused).toHaveLength(2);

		secondDrain.resolve();
		await vi.waitFor(() => {
			expect(waiting.messages).toContainEqual({ type: 'SKIP_WAITING', version: 'build-2' });
		});
		firstServiceWorkers.emitControllerChange();
		expect(reload).toHaveBeenCalledTimes(2);

		first.dispose();
		second.dispose();
		expect(resumed).toEqual(paused);
	});

	test('keeps receiver-sensitive timers attached and makes start and stop idempotent', async () => {
		const hub = new FakeChannelHub();
		const waiting = new FakeWorker();
		const registration = new FakeRegistration(waiting);
		const serviceWorkers = new FakeServiceWorkers(Promise.resolve(registration));
		const timers = new ReceiverSensitiveTimers();
		const paused: string[] = [];
		const resumed: string[] = [];
		let channelCreates = 0;
		const coordinator = new PwaUpdateCoordinator(
			runtimeFor(serviceWorkers, timers, {
				createChannel: () => {
					channelCreates += 1;
					return hub.create();
				},
				pauseCommits: (reason) => paused.push(reason),
				resumeCommits: (reason) => resumed.push(reason)
			})
		);

		await Promise.all([coordinator.start(), coordinator.start()]);
		expect(channelCreates).toBe(1);
		expect(timers.intervalStarts).toBe(1);
		expect(serviceWorkers.listenerCount('message')).toBe(1);
		expect(serviceWorkers.listenerCount('controllerchange')).toBe(1);
		expect(registration.listeners).toHaveLength(1);
		serviceWorkers.emitMessage({
			type: 'UPDATE_WAITING',
			version: 'build-2',
			critical: false
		});
		await coordinator.activate();
		expect(timers.timeoutStarts).toBe(1);

		coordinator.dispose();
		coordinator.dispose();
		expect(timers.intervalClears).toBe(1);
		expect(timers.timeoutClears).toBe(1);
		expect(timers.intervals).toHaveLength(0);
		expect(timers.timeouts).toHaveLength(0);
		expect(serviceWorkers.listenerCount('message')).toBe(0);
		expect(serviceWorkers.listenerCount('controllerchange')).toBe(0);
		expect(registration.listeners).toHaveLength(0);
		expect(resumed).toEqual(paused);

		await coordinator.start();
		expect(channelCreates).toBe(2);
		expect(timers.intervalStarts).toBe(2);
		expect(serviceWorkers.listenerCount('message')).toBe(1);
		expect(registration.listeners).toHaveLength(1);
		coordinator.dispose();
	});

	test('prepares a tab that opens mid-update so the update can still activate', async () => {
		vi.useFakeTimers();
		try {
			const tabs = new UpdateTabs();
			const first = tabs.open();
			await first.coordinator.start();
			first.serviceWorkers.emitMessage({
				type: 'UPDATE_WAITING',
				version: 'build-2',
				critical: false
			});
			await first.coordinator.activate();
			const late = tabs.open();
			await late.coordinator.start();
			late.serviceWorkers.emitMessage({
				type: 'UPDATE_WAITING',
				version: 'build-2',
				critical: false
			});
			await vi.advanceTimersByTimeAsync(1_000);

			expect(late.paused).toHaveLength(1);
			expect(late.status()).toBe('preparing');
			expect(tabs.waiting.messages).toContainEqual({ type: 'SKIP_WAITING', version: 'build-2' });
		} finally {
			vi.useRealTimers();
		}
	});

	test('waits for the initiating tab to drain even when every peer is ready first', async () => {
		vi.useFakeTimers();
		try {
			const tabs = new UpdateTabs();
			const ownDrain = deferred();
			const first = tabs.open(() => ownDrain.promise);
			const peer = tabs.open();
			await Promise.all([first.coordinator.start(), peer.coordinator.start()]);
			first.serviceWorkers.emitMessage({
				type: 'UPDATE_WAITING',
				version: 'build-2',
				critical: false
			});
			void first.coordinator.activate();
			await vi.advanceTimersByTimeAsync(6_000);
			expect(tabs.waiting.messages).not.toContainEqual({
				type: 'SKIP_WAITING',
				version: 'build-2'
			});

			ownDrain.resolve();
			await vi.advanceTimersByTimeAsync(1_000);
			expect(tabs.waiting.messages).toContainEqual({ type: 'SKIP_WAITING', version: 'build-2' });
		} finally {
			vi.useRealTimers();
		}
	});

	test('cancelling a waiting update resumes local commits in every tab', async () => {
		vi.useFakeTimers();
		try {
			const tabs = new UpdateTabs();
			const stuckDrain = deferred();
			const first = tabs.open();
			const stuck = tabs.open(() => stuckDrain.promise);
			await Promise.all([first.coordinator.start(), stuck.coordinator.start()]);
			first.serviceWorkers.emitMessage({
				type: 'UPDATE_WAITING',
				version: 'build-2',
				critical: false
			});
			await first.coordinator.activate();
			await vi.advanceTimersByTimeAsync(1_000);
			expect(first.status()).toBe('waiting-for-tabs');

			first.coordinator.cancel();
			stuckDrain.resolve();
			await vi.advanceTimersByTimeAsync(6_000);

			expect(first.status()).toBe('available');
			expect(stuck.status()).toBe('available');
			expect(first.resumed).toEqual(first.paused);
			expect(stuck.resumed).toEqual(stuck.paused);
			expect(tabs.waiting.messages).not.toContainEqual({
				type: 'SKIP_WAITING',
				version: 'build-2'
			});
		} finally {
			vi.useRealTimers();
		}
	});

	test('cancels delayed activation and an unresolved startup when stopped', async () => {
		const ready = deferred();
		const waiting = new FakeWorker();
		const registration = new FakeRegistration(waiting);
		const serviceWorkers = new FakeServiceWorkers(ready.promise.then(() => registration));
		const timers = new ReceiverSensitiveTimers();
		const coordinator = new PwaUpdateCoordinator(runtimeFor(serviceWorkers, timers));

		const startup = coordinator.start();
		coordinator.dispose();
		ready.resolve();
		await startup;

		expect(registration.listeners).toHaveLength(0);
		expect(waiting.messages).toHaveLength(0);
		expect(timers.intervals).toHaveLength(0);
		expect(serviceWorkers.listenerCount('message')).toBe(0);
	});
});

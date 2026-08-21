import { describe, expect, test, vi } from 'vitest';

import { PwaUpdateCoordinator, type PwaUpdateRuntime } from '$lib/client/pwa/update-coordinator.js';

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
}

class FakeServiceWorkers {
	readonly controller = {};
	listeners = new Map<string, ((event: { data: unknown }) => void)[]>();

	constructor(readonly ready: Promise<FakeRegistration>) {}

	addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
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
	constructor(readonly waiting: FakeWorker) {}
	addEventListener(): void {}
}

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
};

describe('PWA update coordination', () => {
	test('does not activate until every live tab has drained its local commits', async () => {
		const hub = new FakeChannelHub();
		const waiting = new FakeWorker();
		const registration = new FakeRegistration(waiting);
		const firstServiceWorkers = new FakeServiceWorkers(Promise.resolve(registration));
		const secondServiceWorkers = new FakeServiceWorkers(Promise.resolve(registration));
		const secondDrain = deferred();
		const paused: string[] = [];
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
			setInterval: (() => 1) as unknown as typeof setInterval,
			clearInterval: (() => undefined) as unknown as typeof clearInterval,
			setTimeout,
			pauseCommits: (reason) => paused.push(reason),
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
	});
});

import { uuidv7 } from 'uuidv7';

import {
	pauseAllLocalCommits,
	waitForLocalCommitsToDrain
} from '$lib/client/local/commit-activity.js';
import { subscribeLocalDatabaseEvents } from '$lib/client/local/database-events.js';
import {
	isServiceWorkerEvent,
	isUpdateChannelMessage,
	type UpdateChannelMessage
} from '$lib/pwa/messages.js';

const CHANNEL_NAME = 'maal-pwa-updates-v1';
const HEARTBEAT_MS = 5_000;
const LIVE_TAB_MS = 15_000;

export type PwaUpdateStatus =
	'idle' | 'available' | 'preparing' | 'waiting-for-tabs' | 'reload-required';

export interface PwaUpdateState {
	readonly status: PwaUpdateStatus;
	readonly version: string | null;
	readonly critical: boolean;
	readonly message: string | null;
}

type Listener = (state: PwaUpdateState) => void;

interface UpdateWorker {
	readonly scriptURL: string;
	readonly state?: string;
	postMessage(message: unknown): void;
	addEventListener(type: 'statechange', listener: () => void): void;
	removeEventListener(type: 'statechange', listener: () => void): void;
}

interface UpdateRegistration {
	readonly waiting: UpdateWorker | null;
	readonly installing: UpdateWorker | null;
	addEventListener(type: 'updatefound', listener: () => void): void;
	removeEventListener(type: 'updatefound', listener: () => void): void;
}

interface UpdateServiceWorkerContainer {
	readonly ready: Promise<UpdateRegistration>;
	readonly controller: unknown;
	addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
	addEventListener(type: 'controllerchange', listener: () => void): void;
	removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
	removeEventListener(type: 'controllerchange', listener: () => void): void;
}

interface UpdateChannel {
	postMessage(message: unknown): void;
	addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
	close(): void;
}

export interface PwaUpdateTimers {
	setInterval(callback: () => void, delay?: number): ReturnType<typeof setInterval>;
	clearInterval(handle: ReturnType<typeof setInterval>): void;
	setTimeout(callback: () => void, delay?: number): ReturnType<typeof setTimeout>;
	clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface PwaUpdateRuntime {
	readonly serviceWorker: UpdateServiceWorkerContainer | null;
	readonly createChannel: (name: string) => UpdateChannel;
	readonly createId: () => string;
	readonly now: () => number;
	readonly timers: PwaUpdateTimers;
	readonly pauseCommits: (reason: string) => void;
	readonly drainCommits: () => Promise<void>;
	readonly reload: () => void;
}

const browserTimers = (): PwaUpdateTimers => {
	const receiver = globalThis;
	return {
		setInterval: (callback, delay) => receiver.setInterval(callback, delay),
		clearInterval: (handle) => receiver.clearInterval(handle),
		setTimeout: (callback, delay) => receiver.setTimeout(callback, delay),
		clearTimeout: (handle) => receiver.clearTimeout(handle)
	};
};

const browserRuntime = (): PwaUpdateRuntime => ({
	serviceWorker:
		typeof navigator === 'undefined'
			? null
			: (navigator.serviceWorker as unknown as UpdateServiceWorkerContainer),
	createChannel: (name) => new BroadcastChannel(name),
	createId: uuidv7,
	now: Date.now,
	timers: browserTimers(),
	pauseCommits: pauseAllLocalCommits,
	drainCommits: waitForLocalCommitsToDrain,
	reload: () => window.location.reload()
});

export class PwaUpdateCoordinator {
	readonly tabId: string;
	#runtime: PwaUpdateRuntime;
	#channel: UpdateChannel | null = null;
	#registration: UpdateRegistration | null = null;
	#listeners = new Set<Listener>();
	#peers = new Map<string, number>();
	#readyTabs = new Set<string>();
	#requestId: string | null = null;
	#heartbeat: ReturnType<typeof setInterval> | null = null;
	#activationTimeout: ReturnType<typeof setTimeout> | null = null;
	#unsubscribeDatabaseEvents: (() => void) | null = null;
	#removeServiceWorkerListeners: (() => void) | null = null;
	#removeRegistrationListener: (() => void) | null = null;
	#removeInstallingListener: (() => void) | null = null;
	#lifecycle = 0;
	#started = false;
	#state: PwaUpdateState = { status: 'idle', version: null, critical: false, message: null };

	constructor(runtime: PwaUpdateRuntime = browserRuntime()) {
		this.#runtime = runtime;
		this.tabId = runtime.createId();
	}

	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => this.#listeners.delete(listener);
	}

	async start(): Promise<void> {
		const serviceWorker = this.#runtime.serviceWorker;
		if (!serviceWorker || this.#started) return;
		this.#started = true;
		const lifecycle = ++this.#lifecycle;
		try {
			this.#channel = this.#runtime.createChannel(CHANNEL_NAME);
			this.#channel.addEventListener('message', (event) => this.#receiveChannel(event.data));
			const receiveServiceWorkerMessage = (event: { data: unknown }) => {
				if (!this.#started || !isServiceWorkerEvent(event.data)) return;
				if (event.data.type !== 'UPDATE_WAITING') return;
				this.#announceUpdate(event.data.version, event.data.critical);
			};
			const handleControllerChange = () => {
				if (!this.#started || !['preparing', 'waiting-for-tabs'].includes(this.#state.status)) {
					return;
				}
				this.#post({
					type: 'RELOAD',
					tabId: this.tabId,
					version: this.#state.version ?? 'unknown'
				});
				this.#runtime.reload();
			};
			serviceWorker.addEventListener('message', receiveServiceWorkerMessage);
			serviceWorker.addEventListener('controllerchange', handleControllerChange);
			this.#removeServiceWorkerListeners = () => {
				serviceWorker.removeEventListener('message', receiveServiceWorkerMessage);
				serviceWorker.removeEventListener('controllerchange', handleControllerChange);
			};
			this.#unsubscribeDatabaseEvents = subscribeLocalDatabaseEvents((event) => {
				if (!this.#started) return;
				this.#setState({
					status: 'reload-required',
					version: this.#state.version,
					critical: true,
					message:
						event.type === 'blocked'
							? 'Another tab is waiting to finish a database upgrade.'
							: 'Local storage changed in another tab. Reload to continue safely.'
				});
			});
			this.#sendHeartbeat();
			this.#heartbeat = this.#runtime.timers.setInterval(
				() => this.#sendHeartbeat(),
				HEARTBEAT_MS
			);
			const registration = await serviceWorker.ready;
			if (!this.#started || lifecycle !== this.#lifecycle) return;
			this.#registration = registration;
			this.#watchRegistration(registration);
			if (registration.waiting) {
				if (this.#state.critical && this.#state.version) void this.activate();
				else registration.waiting.postMessage({ type: 'GET_VERSION' });
			}
		} catch (error) {
			if (this.#started && lifecycle === this.#lifecycle) this.dispose();
			throw error;
		}
	}

	dispose(): void {
		if (!this.#started && !this.#channel) return;
		this.#started = false;
		this.#lifecycle += 1;
		if (this.#heartbeat !== null) this.#runtime.timers.clearInterval(this.#heartbeat);
		if (this.#activationTimeout !== null) {
			this.#runtime.timers.clearTimeout(this.#activationTimeout);
		}
		this.#heartbeat = null;
		this.#activationTimeout = null;
		this.#removeInstallingListener?.();
		this.#removeRegistrationListener?.();
		this.#removeServiceWorkerListeners?.();
		this.#removeInstallingListener = null;
		this.#removeRegistrationListener = null;
		this.#removeServiceWorkerListeners = null;
		this.#unsubscribeDatabaseEvents?.();
		this.#unsubscribeDatabaseEvents = null;
		this.#channel?.close();
		this.#channel = null;
		this.#registration = null;
		this.#requestId = null;
		this.#readyTabs.clear();
		this.#peers.clear();
	}

	async activate(): Promise<void> {
		if (!this.#state.version || !this.#registration?.waiting) return;
		const requestId = this.#runtime.createId();
		this.#requestId = requestId;
		this.#readyTabs.clear();
		this.#setState({ ...this.#state, status: 'preparing', message: 'Finishing local changes…' });
		const message: UpdateChannelMessage = {
			type: 'PREPARE_UPDATE',
			tabId: this.tabId,
			requestId,
			version: this.#state.version,
			critical: this.#state.critical
		};
		this.#post(message);
		await this.#prepareTab(message);
	}

	#watchRegistration(registration: UpdateRegistration): void {
		const updateFound = () => {
			this.#removeInstallingListener?.();
			this.#removeInstallingListener = null;
			const installing = registration.installing;
			if (!installing) return;
			const stateChanged = () => {
				if (!this.#started) return;
				if (installing.state !== 'installed' || !this.#runtime.serviceWorker?.controller) return;
				installing.postMessage({ type: 'GET_VERSION' });
			};
			installing.addEventListener('statechange', stateChanged);
			this.#removeInstallingListener = () =>
				installing.removeEventListener('statechange', stateChanged);
		};
		registration.addEventListener('updatefound', updateFound);
		this.#removeRegistrationListener = () =>
			registration.removeEventListener('updatefound', updateFound);
	}

	#announceUpdate(version: string, critical: boolean): void {
		this.#setState({ status: 'available', version, critical, message: null });
		this.#post({ type: 'UPDATE_AVAILABLE', tabId: this.tabId, version, critical });
		if (critical) void this.activate();
	}

	#receiveChannel(value: unknown): void {
		if (!isUpdateChannelMessage(value) || value.tabId === this.tabId) return;
		this.#peers.set(value.tabId, this.#runtime.now());
		switch (value.type) {
			case 'HEARTBEAT':
				this.#peers.set(value.tabId, value.sentAt);
				break;
			case 'UPDATE_AVAILABLE':
				if (this.#state.status === 'idle') {
					this.#setState({
						status: 'available',
						version: value.version,
						critical: value.critical,
						message: null
					});
				}
				break;
			case 'PREPARE_UPDATE':
				void this.#prepareTab(value);
				break;
			case 'UPDATE_READY':
				if (value.requestId === this.#requestId) {
					this.#readyTabs.add(value.tabId);
					this.#tryActivation();
				}
				break;
			case 'UPDATE_PREPARING':
				break;
			case 'RELOAD':
				this.#runtime.reload();
				break;
		}
	}

	async #prepareTab(
		message: Extract<UpdateChannelMessage, { type: 'PREPARE_UPDATE' }>
	): Promise<void> {
		if (!this.#started) return;
		const lifecycle = this.#lifecycle;
		if (message.tabId !== this.tabId) {
			this.#post({ type: 'UPDATE_PREPARING', tabId: this.tabId, requestId: message.requestId });
		}
		this.#runtime.pauseCommits(`service-worker-update:${message.requestId}`);
		this.#setState({
			status: 'preparing',
			version: message.version,
			critical: message.critical,
			message: 'Finishing local changes…'
		});
		await this.#runtime.drainCommits();
		if (!this.#started || lifecycle !== this.#lifecycle) return;
		if (message.tabId === this.tabId) {
			this.#readyTabs.add(this.tabId);
			if (this.#activationTimeout !== null) {
				this.#runtime.timers.clearTimeout(this.#activationTimeout);
			}
			this.#activationTimeout = this.#runtime.timers.setTimeout(() => {
				this.#activationTimeout = null;
				this.#tryActivation();
			}, 250);
		} else {
			this.#post({ type: 'UPDATE_READY', tabId: this.tabId, requestId: message.requestId });
		}
	}

	#tryActivation(): void {
		if (!this.#requestId || !this.#registration?.waiting || !this.#state.version) return;
		const now = this.#runtime.now();
		const livePeers = [...this.#peers]
			.filter(([, seenAt]) => now - seenAt <= LIVE_TAB_MS)
			.map(([tabId]) => tabId);
		if (!livePeers.every((tabId) => this.#readyTabs.has(tabId))) {
			this.#setState({
				...this.#state,
				status: 'waiting-for-tabs',
				message: 'Waiting for another open Maal tab…'
			});
			return;
		}
		this.#registration.waiting.postMessage({
			type: 'SKIP_WAITING',
			version: this.#state.version
		});
	}

	#sendHeartbeat(): void {
		const now = this.#runtime.now();
		for (const [tabId, seenAt] of this.#peers) {
			if (now - seenAt > LIVE_TAB_MS) this.#peers.delete(tabId);
		}
		this.#post({ type: 'HEARTBEAT', tabId: this.tabId, sentAt: now });
		if (this.#state.status === 'waiting-for-tabs') this.#tryActivation();
	}

	#post(message: UpdateChannelMessage): void {
		this.#channel?.postMessage(message);
	}

	#setState(state: PwaUpdateState): void {
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}
}

let singleton: PwaUpdateCoordinator | null = null;

export const getPwaUpdateCoordinator = (): PwaUpdateCoordinator =>
	(singleton ??= new PwaUpdateCoordinator());

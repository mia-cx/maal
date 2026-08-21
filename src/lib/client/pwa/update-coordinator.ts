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
}

interface UpdateRegistration {
	readonly waiting: UpdateWorker | null;
	readonly installing: UpdateWorker | null;
	addEventListener(type: 'updatefound', listener: () => void): void;
}

interface UpdateServiceWorkerContainer {
	readonly ready: Promise<UpdateRegistration>;
	readonly controller: unknown;
	addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
	addEventListener(type: 'controllerchange', listener: () => void): void;
}

interface UpdateChannel {
	postMessage(message: unknown): void;
	addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
	close(): void;
}

export interface PwaUpdateRuntime {
	readonly serviceWorker: UpdateServiceWorkerContainer | null;
	readonly createChannel: (name: string) => UpdateChannel;
	readonly createId: () => string;
	readonly now: () => number;
	readonly setInterval: typeof setInterval;
	readonly clearInterval: typeof clearInterval;
	readonly setTimeout: typeof setTimeout;
	readonly pauseCommits: (reason: string) => void;
	readonly drainCommits: () => Promise<void>;
	readonly reload: () => void;
}

const browserRuntime = (): PwaUpdateRuntime => ({
	serviceWorker:
		typeof navigator === 'undefined'
			? null
			: (navigator.serviceWorker as unknown as UpdateServiceWorkerContainer),
	createChannel: (name) => new BroadcastChannel(name),
	createId: uuidv7,
	now: Date.now,
	setInterval,
	clearInterval,
	setTimeout,
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
	#unsubscribeDatabaseEvents: (() => void) | null = null;
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
		if (!serviceWorker || this.#channel) return;
		this.#channel = this.#runtime.createChannel(CHANNEL_NAME);
		this.#channel.addEventListener('message', (event) => this.#receiveChannel(event.data));
		serviceWorker.addEventListener('message', (event) => {
			if (!isServiceWorkerEvent(event.data) || event.data.type !== 'UPDATE_WAITING') return;
			this.#announceUpdate(event.data.version, event.data.critical);
		});
		serviceWorker.addEventListener('controllerchange', () => {
			if (!['preparing', 'waiting-for-tabs'].includes(this.#state.status)) return;
			this.#post({
				type: 'RELOAD',
				tabId: this.tabId,
				version: this.#state.version ?? 'unknown'
			});
			this.#runtime.reload();
		});
		this.#unsubscribeDatabaseEvents = subscribeLocalDatabaseEvents((event) => {
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
		this.#heartbeat = this.#runtime.setInterval(() => this.#sendHeartbeat(), HEARTBEAT_MS);
		this.#registration = await serviceWorker.ready;
		this.#watchRegistration(this.#registration);
		if (this.#registration.waiting) {
			if (this.#state.critical && this.#state.version) void this.activate();
			else this.#registration.waiting.postMessage({ type: 'GET_VERSION' });
		}
	}

	dispose(): void {
		if (this.#heartbeat) this.#runtime.clearInterval(this.#heartbeat);
		this.#unsubscribeDatabaseEvents?.();
		this.#channel?.close();
		this.#channel = null;
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
		registration.addEventListener('updatefound', () => {
			const installing = registration.installing;
			installing?.addEventListener('statechange', () => {
				if (installing.state !== 'installed' || !this.#runtime.serviceWorker?.controller) return;
				installing.postMessage({ type: 'GET_VERSION' });
			});
		});
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
		if (message.tabId === this.tabId) {
			this.#readyTabs.add(this.tabId);
			this.#runtime.setTimeout(() => this.#tryActivation(), 250);
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

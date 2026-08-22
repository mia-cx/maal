export interface SyncRequestedScope {
	readonly scopeKind: 'user' | 'household';
	readonly scopeId: string;
}

export interface SyncRequestedEvent {
	readonly databaseName: string;
	readonly scopes: readonly SyncRequestedScope[];
}

type Listener = (event: SyncRequestedEvent) => void;
const listeners = new Set<Listener>();

export const requestLocalSync = (event: SyncRequestedEvent): void => {
	for (const listener of listeners) listener(event);
};

export const subscribeLocalSyncRequests = (listener: Listener): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

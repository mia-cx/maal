export type LocalDatabaseEvent =
	| { readonly type: 'versionchange'; readonly databaseName: string }
	| { readonly type: 'blocked'; readonly databaseName: string };

type Listener = (event: LocalDatabaseEvent) => void;
const listeners = new Set<Listener>();

export const publishLocalDatabaseEvent = (event: LocalDatabaseEvent): void => {
	for (const listener of listeners) listener(event);
};

export const subscribeLocalDatabaseEvents = (listener: Listener): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

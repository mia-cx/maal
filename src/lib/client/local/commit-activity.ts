import { LocalPersistenceError } from '$lib/domain/contracts/errors.js';

export interface CommitActivitySnapshot {
	readonly inFlight: number;
	readonly blocked: boolean;
}

type Listener = (snapshot: CommitActivitySnapshot) => void;

const listeners = new Set<Listener>();
const blockers = new Map<string, Set<string>>();
let inFlight = 0;

const snapshot = (): CommitActivitySnapshot => ({
	inFlight,
	blocked: [...blockers.values()].some((reasons) => reasons.size > 0)
});

const publish = (): void => {
	const current = snapshot();
	for (const listener of listeners) listener(current);
};

const reasonsFor = (databaseName: string): Set<string> => {
	let reasons = blockers.get(databaseName);
	if (!reasons) {
		reasons = new Set();
		blockers.set(databaseName, reasons);
	}
	return reasons;
};

export const readCommitActivity = (): CommitActivitySnapshot => snapshot();

export const subscribeCommitActivity = (listener: Listener): (() => void) => {
	listeners.add(listener);
	listener(snapshot());
	return () => listeners.delete(listener);
};

export const pauseLocalCommits = (databaseName: string, reason: string): void => {
	reasonsFor(databaseName).add(reason);
	publish();
};

export const resumeLocalCommits = (databaseName: string, reason: string): void => {
	const reasons = blockers.get(databaseName);
	reasons?.delete(reason);
	if (reasons?.size === 0) blockers.delete(databaseName);
	publish();
};

export const waitForLocalCommitsToDrain = async (): Promise<void> => {
	if (inFlight === 0) return;
	await new Promise<void>((resolve) => {
		const unsubscribe = subscribeCommitActivity(({ inFlight: current }) => {
			if (current !== 0) return;
			unsubscribe();
			resolve();
		});
	});
};

export const runTrackedLocalCommit = async <A>(
	databaseName: string,
	operation: string,
	commit: () => Promise<A>
): Promise<A> => {
	if (reasonsFor(databaseName).size > 0) {
		throw new LocalPersistenceError({
			operation,
			message: 'Local changes are paused while this tab prepares a safe reload.'
		});
	}
	inFlight += 1;
	publish();
	try {
		return await commit();
	} finally {
		inFlight -= 1;
		publish();
	}
};

export const resetCommitActivityForTests = (): void => {
	inFlight = 0;
	blockers.clear();
	publish();
};

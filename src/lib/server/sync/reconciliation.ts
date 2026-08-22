import type { SyncMutation } from '$lib/sync/contracts.js';

export const BACKFILL_CLOCK_SKEW_MS = 60 * 60 * 1000;

export interface WinningClock {
	readonly occurredAt: string;
	readonly originDeviceId: string;
	readonly mutationId: string;
}

export const incomingWinsHistoricalConflict = (
	current: WinningClock | null,
	incoming: Pick<SyncMutation, 'occurredAt' | 'originDeviceId' | 'mutationId'>
): boolean => {
	if (current === null) return true;
	const delta = Date.parse(incoming.occurredAt) - Date.parse(current.occurredAt);
	if (Math.abs(delta) > BACKFILL_CLOCK_SKEW_MS) return delta > 0;
	// Inside the skew window, the next D1 commit wins. This is deliberately not a client-clock tie-break.
	return true;
};

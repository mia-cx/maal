import { stalenessThresholdMs } from '$lib/domain/household/staleness.js';
import type { SyncMutation } from '$lib/sync/contracts.js';

export interface WinningClock {
	readonly occurredAt: string;
	readonly originDeviceId: string;
	readonly mutationId: string;
}

/**
 * Whether a backfilled contender beats the stored winner of one conflict group. Event times further
 * apart than the audience's staleness threshold resolve by `occurredAt`; closer ones are possible
 * clock skew, so the next D1 commit wins.
 */
export const incomingWinsHistoricalConflict = (
	current: WinningClock | null,
	incoming: Pick<SyncMutation, 'occurredAt' | 'originDeviceId' | 'mutationId'>,
	stalenessThresholdMinutes: number
): boolean => {
	if (current === null) return true;
	const delta = Date.parse(incoming.occurredAt) - Date.parse(current.occurredAt);
	if (Math.abs(delta) > stalenessThresholdMs(stalenessThresholdMinutes)) return delta > 0;
	// Inside the skew window, the next D1 commit wins. This is deliberately not a client-clock tie-break.
	return true;
};

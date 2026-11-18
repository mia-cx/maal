import { Schema } from 'effect';

/**
 * How long an edit may wait on a device and still count as current (spec §8.4). Within it, an edit
 * brings a deleted entity back and backfill contenders resolve by D1 commit order. Households set
 * their own; user audiences always use the default.
 */
export const DEFAULT_STALENESS_THRESHOLD_MINUTES = 180;
const MAX_STALENESS_THRESHOLD_MINUTES = 7 * 24 * 60;

export const StalenessThresholdMinutesSchema = Schema.Number.pipe(
	Schema.int(),
	Schema.between(1, MAX_STALENESS_THRESHOLD_MINUTES)
);

export const stalenessThresholdMs = (minutes: number): number => minutes * 60_000;

/**
 * True when an edit made at `occurredAt` (the device's clock) reached the Worker at `receivedAt`
 * (the Worker's clock) within the threshold. A future `occurredAt` counts as age zero.
 */
export const isRecentEdit = (
	occurredAt: string,
	receivedAt: string,
	thresholdMinutes: number
): boolean =>
	Date.parse(receivedAt) - Date.parse(occurredAt) <= stalenessThresholdMs(thresholdMinutes);

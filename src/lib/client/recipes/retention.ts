import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { UtcInstantSchema, type UtcInstant } from '$lib/domain/contracts/primitives.js';

import { runRecipeRetention } from './commands.js';

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1_000;

const utc = (date: Date): UtcInstant => Schema.decodeUnknownSync(UtcInstantSchema)(date.toISOString());

export interface ForegroundRecipeRetentionResult {
	readonly profileCount: number;
	readonly purgedRecipeCount: number;
	readonly expiredTombstoneCount: number;
	readonly hasMore: boolean;
}

export const runForegroundRecipeRetention = async (
	database: MaalDatabase,
	now = new Date(),
	batchSize = 25
): Promise<ForegroundRecipeRetentionResult> => {
	const [device, slots] = await Promise.all([
		database.meta.get('deviceId'),
		database.authSlots.toArray()
	]);
	if (typeof device?.value !== 'string') throw new TypeError('The local device ID is unavailable.');
	const occurredAt = utc(now);

	const slotByUser = new Map(slots.map((slot) => [slot.workosUserId, slot]));
	let purgedRecipeCount = 0;
	let expiredTombstoneCount = 0;
	let hasMore = false;
	for (const slot of slotByUser.values()) {
		const result = await runRecipeRetention(
			database,
			{
				authSlotId: slot.authSlotId,
				ownerUserId: slot.workosUserId,
				originDeviceId: device.value,
				occurredAt
			},
			occurredAt,
			batchSize
		);
		purgedRecipeCount += result.purgedRecipeIds.length;
		expiredTombstoneCount += result.expiredTombstoneIds.length;
		hasMore ||= result.hasMore;
	}
	return {
		profileCount: slotByUser.size,
		purgedRecipeCount,
		expiredTombstoneCount,
		hasMore
	};
};

export const startForegroundRecipeRetention = (database: MaalDatabase): void => {
	let running = false;
	const run = async (): Promise<void> => {
		if (running || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
		running = true;
		try {
			await runForegroundRecipeRetention(database);
		} catch {
			console.error(JSON.stringify({ event: 'local_recipe_retention_failed' }));
		} finally {
			running = false;
		}
	};

	void run();
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	window.setInterval(() => void run(), RETENTION_INTERVAL_MS);
	document.addEventListener('visibilitychange', () => void run());
};

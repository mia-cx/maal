import type { MaalDatabase } from '$lib/client/local/database.js';

import { createUserSyncCoordinator, type UserSyncCoordinator } from './coordinator.js';
import { createFetchUserSyncTransport, type UserSyncTransport } from './transport.js';

export interface DeviceSyncManager {
	stop(): void;
	reconcileAuthSlots(): Promise<void>;
}

export const startDeviceSync = (
	database: MaalDatabase,
	transport: UserSyncTransport = createFetchUserSyncTransport()
): DeviceSyncManager => {
	const coordinators = new Map<string, UserSyncCoordinator>();
	let stopped = false;

	const reconcileAuthSlots = async (): Promise<void> => {
		if (stopped) return;
		const slots = await database.authSlots.toArray();
		const activeIds = new Set(
			slots
				.filter(({ sessionState }) => sessionState === 'authenticated')
				.map(({ authSlotId }) => authSlotId)
		);
		for (const [authSlotId, coordinator] of coordinators) {
			if (activeIds.has(authSlotId)) continue;
			coordinator.stop();
			coordinators.delete(authSlotId);
		}
		for (const slot of slots) {
			if (slot.sessionState !== 'authenticated' || coordinators.has(slot.authSlotId)) continue;
			const coordinator = createUserSyncCoordinator({
				database,
				authSlotId: slot.authSlotId,
				workosUserId: slot.workosUserId,
				transport
			});
			coordinators.set(slot.authSlotId, coordinator);
			coordinator.start();
		}
	};

	const notifyOutbox = (_primaryKey: unknown, record: unknown): void => {
		if (typeof record !== 'object' || record === null || !('authSlotId' in record)) return;
		const authSlotId = (record as { authSlotId?: unknown }).authSlotId;
		if (typeof authSlotId !== 'string') return;
		queueMicrotask(() => coordinators.get(authSlotId)?.notifyLocalMutation());
	};
	const authSlotChanged = (): void => {
		queueMicrotask(() => void reconcileAuthSlots());
	};

	database.outbox.hook('creating', notifyOutbox);
	database.authSlots.hook('creating', authSlotChanged);
	database.authSlots.hook('updating', authSlotChanged);
	database.authSlots.hook('deleting', authSlotChanged);
	void reconcileAuthSlots();

	return {
		reconcileAuthSlots,
		stop() {
			stopped = true;
			database.outbox.hook('creating').unsubscribe(notifyOutbox);
			database.authSlots.hook('creating').unsubscribe(authSlotChanged);
			database.authSlots.hook('updating').unsubscribe(authSlotChanged);
			database.authSlots.hook('deleting').unsubscribe(authSlotChanged);
			for (const coordinator of coordinators.values()) coordinator.stop();
			coordinators.clear();
		}
	};
};

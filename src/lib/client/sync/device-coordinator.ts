import type { MaalDatabase } from '$lib/client/local/database.js';

import {
	createHouseholdSyncCoordinator,
	type HouseholdSyncCoordinator
} from './household-coordinator.js';
import {
	createFetchHouseholdSyncTransport,
	type HouseholdSyncTransport
} from './household-transport.js';
import { createUserSyncCoordinator, type UserSyncCoordinator } from './coordinator.js';
import { createFetchUserSyncTransport, type UserSyncTransport } from './transport.js';

export interface DeviceSyncManager {
	stop(): void;
	reconcileAuthSlots(): Promise<void>;
}

export const startDeviceSync = (
	database: MaalDatabase,
	transport: UserSyncTransport = createFetchUserSyncTransport(),
	householdTransport: HouseholdSyncTransport = createFetchHouseholdSyncTransport()
): DeviceSyncManager => {
	const coordinators = new Map<string, UserSyncCoordinator>();
	const householdCoordinators = new Map<string, HouseholdSyncCoordinator>();
	let stopped = false;
	const householdCoordinatorKey = (authSlotId: string, householdId: string): string =>
		`${authSlotId}\u0000${householdId}`;

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
		const activeHouseholdKeys = new Set<string>();
		for (const slot of slots) {
			if (slot.sessionState !== 'authenticated') continue;
			const memberships = await database.memberships
				.where('[workosUserId+status]')
				.equals([slot.workosUserId, 'active'])
				.toArray();
			for (const membership of memberships) {
				if (!membership.permissions.includes('meals:read')) continue;
				const key = householdCoordinatorKey(slot.authSlotId, membership.householdId);
				activeHouseholdKeys.add(key);
				if (householdCoordinators.has(key)) continue;
				const coordinator = createHouseholdSyncCoordinator({
					database,
					authSlotId: slot.authSlotId,
					workosUserId: slot.workosUserId,
					householdId: membership.householdId,
					transport: householdTransport
				});
				householdCoordinators.set(key, coordinator);
				coordinator.start();
			}
		}
		for (const [key, coordinator] of householdCoordinators) {
			if (activeHouseholdKeys.has(key)) continue;
			coordinator.stop();
			householdCoordinators.delete(key);
		}
	};

	const notifyOutbox = (_primaryKey: unknown, record: unknown): void => {
		if (typeof record !== 'object' || record === null || !('authSlotId' in record)) return;
		const authSlotId = (record as { authSlotId?: unknown }).authSlotId;
		if (typeof authSlotId !== 'string') return;
		const scopeKind = (record as { scopeKind?: unknown }).scopeKind;
		const scopeId = (record as { scopeId?: unknown }).scopeId;
		queueMicrotask(() => {
			if (scopeKind === 'household' && typeof scopeId === 'string') {
				householdCoordinators
					.get(householdCoordinatorKey(authSlotId, scopeId))
					?.notifyLocalMutation();
			} else {
				coordinators.get(authSlotId)?.notifyLocalMutation();
			}
		});
	};
	const authSlotChanged = (): void => {
		queueMicrotask(() => void reconcileAuthSlots());
	};
	const capabilityChanged = (): void => {
		queueMicrotask(() => {
			void reconcileAuthSlots().then(() => {
				for (const coordinator of householdCoordinators.values()) {
					coordinator.resumeAfterCapabilityRefresh();
				}
			});
		});
	};

	database.outbox.hook('creating', notifyOutbox);
	database.authSlots.hook('creating', authSlotChanged);
	database.authSlots.hook('updating', authSlotChanged);
	database.authSlots.hook('deleting', authSlotChanged);
	database.memberships.hook('creating', capabilityChanged);
	database.memberships.hook('updating', capabilityChanged);
	database.memberships.hook('deleting', capabilityChanged);
	database.billingCapabilities.hook('creating', capabilityChanged);
	database.billingCapabilities.hook('updating', capabilityChanged);
	database.billingCapabilities.hook('deleting', capabilityChanged);
	void reconcileAuthSlots();

	return {
		reconcileAuthSlots,
		stop() {
			stopped = true;
			database.outbox.hook('creating').unsubscribe(notifyOutbox);
			database.authSlots.hook('creating').unsubscribe(authSlotChanged);
			database.authSlots.hook('updating').unsubscribe(authSlotChanged);
			database.authSlots.hook('deleting').unsubscribe(authSlotChanged);
			database.memberships.hook('creating').unsubscribe(capabilityChanged);
			database.memberships.hook('updating').unsubscribe(capabilityChanged);
			database.memberships.hook('deleting').unsubscribe(capabilityChanged);
			database.billingCapabilities.hook('creating').unsubscribe(capabilityChanged);
			database.billingCapabilities.hook('updating').unsubscribe(capabilityChanged);
			database.billingCapabilities.hook('deleting').unsubscribe(capabilityChanged);
			for (const coordinator of coordinators.values()) coordinator.stop();
			for (const coordinator of householdCoordinators.values()) coordinator.stop();
			coordinators.clear();
			householdCoordinators.clear();
		}
	};
};

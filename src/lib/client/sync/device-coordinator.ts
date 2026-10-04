import type { Transaction } from 'dexie';

import type { MaalDatabase } from '$lib/client/local/database.js';
import type { BillingCapability } from '$lib/domain/billing/contracts.js';

import {
	createHouseholdSyncCoordinator,
	type HouseholdSyncCoordinator
} from './household-coordinator.js';
import {
	createFetchHouseholdSyncTransport,
	type HouseholdSyncTransport
} from './household-transport.js';
import { createUserSyncCoordinator, type UserSyncCoordinator } from './coordinator.js';
import { localCapabilityAllowsSync } from './capability.js';
import { subscribeLocalSyncRequests } from './requests.js';
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
	const capabilityChanged = (refreshedHouseholdId?: string): void => {
		queueMicrotask(() => {
			void reconcileAuthSlots().then(async () => {
				for (const coordinator of householdCoordinators.values()) {
					coordinator.resumeAfterCapabilityRefresh();
				}
				if (!refreshedHouseholdId || stopped) return;
				const capability = await database.billingCapabilities.get(refreshedHouseholdId);
				// Denial writes stale=true itself; only a fresh grant may clear its block.
				if (!capability || capability.stale || !localCapabilityAllowsSync(capability, new Date())) {
					return;
				}
				const members = new Set(
					(await database.memberships.toArray())
						.filter(
							(membership) =>
								membership.householdId === refreshedHouseholdId &&
								membership.status === 'active' &&
								membership.permissions.includes('recipes:read')
						)
						.map(({ workosUserId }) => workosUserId)
				);
				for (const slot of await database.authSlots.toArray()) {
					if (members.has(slot.workosUserId)) {
						coordinators.get(slot.authSlotId)?.resumeAfterCapabilityRefresh();
					}
				}
			});
		});
	};
	const membershipChanged = (): void => capabilityChanged();
	const billingCreated = (
		_primaryKey: unknown,
		record: BillingCapability,
		transaction: Transaction
	): void => {
		transaction.on('complete', () => capabilityChanged(record.householdId));
	};
	const billingUpdated = (
		_changes: object,
		_primaryKey: unknown,
		record: BillingCapability,
		transaction: Transaction
	): void => billingCreated(_primaryKey, record, transaction);

	database.outbox.hook('creating', notifyOutbox);
	database.authSlots.hook('creating', authSlotChanged);
	database.authSlots.hook('updating', authSlotChanged);
	database.authSlots.hook('deleting', authSlotChanged);
	database.memberships.hook('creating', membershipChanged);
	database.memberships.hook('updating', membershipChanged);
	database.memberships.hook('deleting', membershipChanged);
	database.billingCapabilities.hook('creating', billingCreated);
	database.billingCapabilities.hook('updating', billingUpdated);
	database.billingCapabilities.hook('deleting', membershipChanged);
	void reconcileAuthSlots();
	const unsubscribeSyncRequests = subscribeLocalSyncRequests((event) => {
		if (event.databaseName !== database.name) return;
		for (const scope of event.scopes) {
			if (scope.scopeKind === 'user') {
				for (const coordinator of coordinators.values()) coordinator.notifyLocalMutation();
				continue;
			}
			for (const [key, coordinator] of householdCoordinators) {
				if (key.endsWith(`\u0000${scope.scopeId}`)) coordinator.notifyLocalMutation();
			}
		}
	});

	return {
		reconcileAuthSlots,
		stop() {
			stopped = true;
			unsubscribeSyncRequests();
			database.outbox.hook('creating').unsubscribe(notifyOutbox);
			database.authSlots.hook('creating').unsubscribe(authSlotChanged);
			database.authSlots.hook('updating').unsubscribe(authSlotChanged);
			database.authSlots.hook('deleting').unsubscribe(authSlotChanged);
			database.memberships.hook('creating').unsubscribe(membershipChanged);
			database.memberships.hook('updating').unsubscribe(membershipChanged);
			database.memberships.hook('deleting').unsubscribe(membershipChanged);
			database.billingCapabilities.hook('creating').unsubscribe(billingCreated);
			database.billingCapabilities.hook('updating').unsubscribe(billingUpdated);
			database.billingCapabilities.hook('deleting').unsubscribe(membershipChanged);
			for (const coordinator of coordinators.values()) coordinator.stop();
			for (const coordinator of householdCoordinators.values()) coordinator.stop();
			coordinators.clear();
			householdCoordinators.clear();
		}
	};
};

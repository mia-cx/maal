import { NotFoundException, WorkOS } from '@workos-inc/node';
import type Stripe from 'stripe';

import {
	BillingRepository,
	createStripeClient,
	purgeExpiredHouseholds,
	reconcileOutstandingHouseholdDeletionRefunds,
	reconcileStaleTrialClaims
} from '$lib/server/billing/index.js';

import { runScheduledSyncRetention } from './sync-retention.js';

type MaintenanceEnvironment = Env & {
	readonly WORKOS_API_KEY?: string;
	readonly WORKOS_CLIENT_ID?: string;
};

export interface ScheduledMaintenanceResult {
	readonly syncChangesDeleted: number;
	readonly syncReceiptsDeleted: number;
	readonly syncTombstonesDeleted: number;
	readonly syncScopesAdvanced: number;
	readonly householdsPurged: number;
	readonly householdsPending: number;
	readonly householdRowsDeleted: number;
	readonly trialReservationsReleased: number;
	readonly trialRollbacksCompleted: number;
	readonly trialRollbacksPending: number;
	readonly deletionRefundsReconciled: number;
	readonly deletionRefundsPending: number;
}

export const runScheduledMaintenance = async (
	database: D1Database,
	deleteWorkOSOrganization: (householdId: string) => Promise<void>,
	stripe: Stripe
): Promise<ScheduledMaintenanceResult> => {
	const retention = await runScheduledSyncRetention(database);
	const syncResult = retention.reduce(
		(result, batch) => ({
			syncChangesDeleted: result.syncChangesDeleted + batch.changesDeleted,
			syncReceiptsDeleted: result.syncReceiptsDeleted + batch.receiptsDeleted,
			syncTombstonesDeleted: result.syncTombstonesDeleted + batch.tombstonesDeleted,
			syncScopesAdvanced: result.syncScopesAdvanced + batch.scopesAdvanced
		}),
		{
			syncChangesDeleted: 0,
			syncReceiptsDeleted: 0,
			syncTombstonesDeleted: 0,
			syncScopesAdvanced: 0
		}
	);
	const serverNow = retention[0]?.serverNow;
	if (!serverNow) throw new TypeError('Scheduled retention did not return D1 server time.');
	const householdResult = await purgeExpiredHouseholds({
		repository: new BillingRepository(database),
		now: serverNow,
		deleteWorkOSOrganization
	});
	const trialResult = await reconcileStaleTrialClaims({
		repository: new BillingRepository(database),
		stripe,
		now: serverNow
	});
	const deletionRefundResult = await reconcileOutstandingHouseholdDeletionRefunds({
		repository: new BillingRepository(database),
		stripe,
		now: serverNow
	});
	return {
		...syncResult,
		householdsPurged: householdResult.purged.length,
		householdsPending: householdResult.pending.length,
		householdRowsDeleted: householdResult.rowsDeleted,
		trialReservationsReleased: trialResult.reservationsReleased,
		trialRollbacksCompleted: trialResult.rollbacksCompleted,
		trialRollbacksPending: trialResult.pending,
		deletionRefundsReconciled: deletionRefundResult.reconciled,
		deletionRefundsPending: deletionRefundResult.pending
	};
};

export const handleScheduledMaintenance = async (env: MaintenanceEnvironment): Promise<void> => {
	const startedAt = Date.now();
	try {
		if (!env.WORKOS_API_KEY) throw new TypeError('WorkOS API key unavailable.');
		const workos = new WorkOS(env.WORKOS_API_KEY, {
			...(env.WORKOS_CLIENT_ID ? { clientId: env.WORKOS_CLIENT_ID } : {})
		});
		const result = await runScheduledMaintenance(
			env.DB,
			async (householdId) => {
				try {
					await workos.organizations.deleteOrganization(householdId);
				} catch (cause) {
					if (!(cause instanceof NotFoundException)) throw cause;
				}
			},
			createStripeClient(env)
		);
		console.log(
			JSON.stringify({
				event: 'maintenance_completed',
				durationMs: Date.now() - startedAt,
				...result
			})
		);
	} catch (cause) {
		console.error(
			JSON.stringify({
				event: 'maintenance_failed',
				durationMs: Date.now() - startedAt,
				error: cause instanceof Error ? cause.name : 'UnknownError'
			})
		);
		throw cause;
	}
};

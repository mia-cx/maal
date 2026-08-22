import { runScheduledSyncRetention } from './sync-retention.js';

export interface ScheduledMaintenanceResult {
	readonly syncChangesDeleted: number;
	readonly syncReceiptsDeleted: number;
	readonly syncTombstonesDeleted: number;
	readonly syncScopesAdvanced: number;
}

export const runScheduledMaintenance = async (
	database: D1Database
): Promise<ScheduledMaintenanceResult> => {
	const retention = await runScheduledSyncRetention(database);
	return retention.reduce<ScheduledMaintenanceResult>(
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
};

export const handleScheduledMaintenance = async (env: Env): Promise<void> => {
	const startedAt = Date.now();
	try {
		const result = await runScheduledMaintenance(env.DB);
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

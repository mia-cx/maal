import { browser } from '$app/environment';
import type { ClientCacheScope } from './context';

const debugFlagKey = 'maal:debug:client-db';

export type ClientDbDebugFlow = 'ui->dexie' | 'dexie->ui' | 'dexie->d1' | 'd1->dexie';

const isEnabled = (): boolean => {
	if (!browser) return false;
	try {
		return (
			localStorage.getItem(debugFlagKey) === '1' ||
			new URLSearchParams(window.location.search).has('debugClientDb')
		);
	} catch {
		return false;
	}
};

const summarizePayload = (payload: unknown): unknown => {
	if (Array.isArray(payload)) return { count: payload.length };
	if (!payload || typeof payload !== 'object') return payload;
	const record = payload as Record<string, unknown>;
	return {
		...('id' in record ? { id: record.id } : {}),
		...('key' in record ? { key: record.key } : {}),
		...('date' in record ? { date: record.date } : {}),
		...('title' in record ? { title: record.title } : {}),
		...('operation' in record ? { operation: record.operation } : {}),
		...('entityType' in record ? { entityType: record.entityType } : {}),
		...('entityId' in record ? { entityId: record.entityId } : {})
	};
};

export const logClientDbDebug = (
	flow: ClientDbDebugFlow,
	action: string,
	details: {
		scope?: ClientCacheScope | null;
		count?: number;
		ids?: readonly string[];
		payload?: unknown;
		extra?: Record<string, unknown>;
	} = {}
) => {
	if (!isEnabled()) return;
	console.debug(`[maal-db:${flow}] ${action}`, {
		...(details.scope
			? { userId: details.scope.userId, householdId: details.scope.householdId }
			: {}),
		...(details.count === undefined ? {} : { count: details.count }),
		...(details.ids ? { ids: details.ids } : {}),
		...(details.payload === undefined ? {} : { payload: summarizePayload(details.payload) }),
		...(details.extra ?? {})
	});
};

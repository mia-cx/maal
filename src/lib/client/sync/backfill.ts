import type { MaalDatabase } from '$lib/client/local/database.js';
import type { ScopeKind } from '$lib/domain/contracts/primitives.js';

import { scopeOutbox } from './outbox.js';

/**
 * Aggregates backfill must skip: the server already has them (an acknowledged row, pushed or received),
 * a push is still carrying them, or an earlier attempt was refused. Only never-acknowledged records
 * with no outcome yet stay eligible.
 */
export const backfillIneligibleKeys = async (
	database: MaalDatabase,
	scopeKind: ScopeKind,
	scopeId: string
): Promise<Set<string>> =>
	new Set(
		(
			await scopeOutbox(database, scopeKind, scopeId, [
				'acknowledged',
				'pending',
				'sending',
				'rejected'
			])
		).map(({ entityKind, aggregateId }) => `${entityKind}\u0000${aggregateId}`)
	);

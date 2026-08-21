import type { AuthenticatedSyncSlot } from '$lib/server/sync/auth.js';
import { d1HouseholdSyncCapabilityAuthorizer } from '$lib/server/sync/capability.js';

import { RemoteComputeRateLimited, type McpPrincipal } from '$lib/server/mcp/contracts.js';

export interface RemoteComputeLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const authorizeBrowserRecipeImport = async (input: {
	database: D1Database;
	actor: AuthenticatedSyncSlot;
	householdId: string;
	now: string;
}): Promise<void> => {
	await d1HouseholdSyncCapabilityAuthorizer.authorize({
		database: input.database,
		workosUserId: input.actor.workosUserId,
		householdId: input.householdId,
		activeWorkOSOrganizationIds: input.actor.activeOrganizationIds,
		permission: 'meals:write',
		now: input.now
	});
};

export const authorizeMcpRecipeImport = (principal: McpPrincipal, householdId: string): void => {
	const household = principal.effectiveHouseholds.find((row) => row.householdId === householdId);
	if (!household || !household.permissions.includes('meals:write')) {
		throw new TypeError('The MCP principal cannot use remote compute for this household.');
	}
};

export const consumeRecipeImportLimit = async (input: {
	limiter: RemoteComputeLimiter;
	workosUserId: string;
	householdId: string;
	mcpKeyId?: string;
}): Promise<void> => {
	const key = [
		'recipe-url',
		input.workosUserId,
		input.householdId,
		...(input.mcpKeyId ? [input.mcpKeyId] : [])
	].join(':');
	if (!(await input.limiter.limit({ key })).success) {
		throw new RemoteComputeRateLimited({ code: 'rate_limited' });
	}
};

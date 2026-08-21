import type { RemoteDomainPort } from '$lib/server/domain/remote-port.js';
import type { RecipeImportedCandidate } from '$lib/domain/recipes/schema.js';
import type { RemoteComputeLimiter } from '$lib/server/recipe-import/remote-compute.js';

import type { MaalApiScope, McpEffectiveHousehold, McpPrincipal } from './contracts.js';
import { toolError } from './results.js';

export interface McpContext {
	readonly principal: McpPrincipal;
	readonly domain: RemoteDomainPort;
	readonly limiter: RemoteComputeLimiter;
	readonly fetchRecipeCandidate: (url: string) => Promise<RecipeImportedCandidate>;
}

export const requireScope = (principal: McpPrincipal, scope: MaalApiScope): void => {
	if (!principal.scopes.includes(scope)) {
		throw toolError('insufficient_scope', `This MCP key does not grant ${scope}.`);
	}
};

const householdArgument = (args: Record<string, unknown>): string | null =>
	typeof args.householdId === 'string' && args.householdId.trim() ? args.householdId.trim() : null;

export const resolveHousehold = (
	context: McpContext,
	args: Record<string, unknown>,
	scope: MaalApiScope,
	permission: string
): McpEffectiveHousehold => {
	requireScope(context.principal, scope);
	const requested = householdArgument(args);
	const householdId =
		requested ??
		(context.principal.effectiveHouseholds.length === 1
			? context.principal.effectiveHouseholds[0]!.householdId
			: null);
	if (!householdId) {
		throw toolError(
			'household_required',
			'This MCP key can access multiple households. Pass householdId.'
		);
	}
	const household = context.principal.effectiveHouseholds.find(
		(row) => row.householdId === householdId
	);
	if (!household) {
		throw toolError('household_forbidden', 'This MCP key cannot access that household.');
	}
	if (!household.permissions.includes(permission)) {
		throw toolError(
			'insufficient_role_permission',
			`The MCP key owner does not have ${permission} in that household.`
		);
	}
	return household;
};

export const resolveUserRecipeProof = (
	context: McpContext,
	args: Record<string, unknown>,
	scope: 'recipes:read' | 'recipes:write'
): McpEffectiveHousehold => {
	requireScope(context.principal, scope);
	const requested = householdArgument(args);
	const households = requested
		? context.principal.effectiveHouseholds.filter(({ householdId }) => householdId === requested)
		: context.principal.effectiveHouseholds;
	if (requested && households.length === 0) {
		throw toolError('household_forbidden', 'This MCP key cannot access that household.');
	}
	const proof = households.find(({ permissions }) => permissions.includes(scope));
	if (!proof) {
		throw toolError(
			'insufficient_role_permission',
			`The MCP key owner does not have ${scope} in a granted paid household.`
		);
	}
	return proof;
};

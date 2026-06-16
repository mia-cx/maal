import { getDb } from '$lib/server/db';
import {
	listUserHouseholds,
	userHasHouseholdPermission,
	type MaalHouseholdPermission
} from '$lib/server/auth/household';
import {
	oneScopedHouseholdId,
	scopeAllowsHousehold,
	type MaalApiScope,
	type McpKeyRecord
} from '$lib/server/auth/mcp-keys';
import { text } from './scalars';
import { toolError } from './results';

export type McpContext = {
	platform: App.Platform | undefined;
	key: McpKeyRecord;
	db: ReturnType<typeof getDb>;
};

export const requireScope = (key: McpKeyRecord, scope: MaalApiScope) => {
	if (!key.scopes.includes(scope)) {
		throw toolError('insufficient_scope', `This MCP key does not grant ${scope}.`);
	}
};

const defaultHouseholdId = async (context: McpContext): Promise<string | null> => {
	const scopedHouseholdId = oneScopedHouseholdId(context.key);
	if (scopedHouseholdId) return scopedHouseholdId;
	if (context.key.householdScope.kind !== 'all') return null;

	const households = await listUserHouseholds(context.platform, context.key.userId);
	return households.length === 1 ? households[0].id : null;
};

export const resolveScopedHouseholdId = async (
	context: McpContext,
	args: Record<string, unknown>,
	scope: MaalApiScope
): Promise<string> => {
	requireScope(context.key, scope);
	const householdId = text(args.householdId) ?? (await defaultHouseholdId(context));
	if (!householdId) {
		throw toolError(
			'household_required',
			'This MCP key can access multiple households. Pass householdId.'
		);
	}
	if (
		!(await scopeAllowsHousehold({ platform: context.platform, record: context.key, householdId }))
	) {
		throw toolError('household_forbidden', 'This MCP key is not scoped to that household.');
	}
	return householdId;
};

export const resolveHouseholdId = async (
	context: McpContext,
	args: Record<string, unknown>,
	scope: MaalApiScope,
	permission: MaalHouseholdPermission
): Promise<string> => {
	const householdId = await resolveScopedHouseholdId(context, args, scope);
	if (
		!(await userHasHouseholdPermission(
			context.platform,
			context.key.userId,
			householdId,
			permission
		))
	) {
		throw toolError(
			'insufficient_role_permission',
			`The MCP key owner does not have ${permission} in that household.`
		);
	}
	return householdId;
};

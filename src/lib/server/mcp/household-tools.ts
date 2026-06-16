import { listUserHouseholds, type UserHousehold } from '$lib/server/auth/household';
import type { McpKeyHouseholdScope } from '$lib/server/auth/mcp-keys';
import { requireScope } from './context';
import { emptyInput } from './schemas';
import type { ToolDefinition } from './registry';

export const filterHouseholdsForScope = (
	households: UserHousehold[],
	scope: McpKeyHouseholdScope
): UserHousehold[] => {
	if (scope.kind === 'all') return households;
	const allowedIds = new Set(scope.householdIds);
	return households.filter((household) => allowedIds.has(household.id));
};

export const householdTools: ToolDefinition[] = [
	{
		name: 'list_user_households',
		description:
			'List households this MCP key can access. Call this first when a tool asks for householdId or when the user mentions a specific household. If only one household is returned, other tools can usually omit householdId.',
		inputSchema: emptyInput,
		annotations: { readOnlyHint: true },
		handler: async (context) => {
			requireScope(context.key, 'households:read');
			const households = filterHouseholdsForScope(
				await listUserHouseholds(context.platform, context.key.userId),
				context.key.householdScope
			);
			return { households };
		}
	}
];

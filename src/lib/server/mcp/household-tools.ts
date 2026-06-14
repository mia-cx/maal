import { listUserHouseholds } from '$lib/server/auth/household';
import { requireScope } from './context';
import { emptyInput } from './schemas';
import type { ToolDefinition } from './registry';

export const householdTools: ToolDefinition[] = [
	{
		name: 'list_user_households',
		description:
			'List households this MCP key can access. Call this first when a tool asks for householdId or when the user mentions a specific household. If only one household is returned, other tools can usually omit householdId.',
		inputSchema: emptyInput,
		annotations: { readOnlyHint: true },
		handler: async (context) => {
			requireScope(context.key, 'households:read');
			const households = await listUserHouseholds(context.platform, context.key.userId);
			return { households };
		}
	}
];

import type { SettingsHousehold } from './types';

export type McpScope =
	| 'households:read'
	| 'households:write'
	| 'recipes:read'
	| 'recipes:write'
	| 'meals:read'
	| 'meals:write'
	| 'check_ins:read'
	| 'check_ins:write'
	| 'food_profile:read'
	| 'food_profile:write';
export type McpKeyPreset = 'read_only_planner' | 'meal_planner' | 'full_access';
export type McpScopeLevel = 'none' | 'read' | 'write';
export type McpScopeGroup = {
	id: string;
	label: string;
	description: string;
	read?: McpScope;
	write?: McpScope;
};

export type McpKey = {
	id: string;
	label: string;
	householdScope: { kind: 'all' } | { kind: 'households'; householdIds: string[] };
	scopes: McpScope[];
	preset?: McpKeyPreset;
	createdAt: string;
	expiresAt?: string | null;
	revokedAt?: string | null;
	lastUsedAt?: string | null;
	households?: SettingsHousehold[];
};

export const mcpScopeGroups: McpScopeGroup[] = [
	{
		id: 'households',
		label: 'Households',
		description: 'Read or manage household membership and settings.',
		read: 'households:read',
		write: 'households:write'
	},
	{
		id: 'recipes',
		label: 'Recipes',
		description: 'Read, create, and update saved recipes.',
		read: 'recipes:read',
		write: 'recipes:write'
	},
	{
		id: 'meals',
		label: 'Meal plan',
		description: 'Read and manage planned meals.',
		read: 'meals:read',
		write: 'meals:write'
	},
	{
		id: 'checkIns',
		label: 'Check-ins',
		description: 'Record meal feedback after cooking.',
		read: 'check_ins:read',
		write: 'check_ins:write'
	},
	{
		id: 'foodProfile',
		label: 'Food profile',
		description: 'Read or update taxonomy preferences.',
		read: 'food_profile:read',
		write: 'food_profile:write'
	}
];

export const presetLabel = (preset?: McpKeyPreset): string => {
	if (preset === 'read_only_planner') return 'Read-only planner';
	if (preset === 'meal_planner') return 'Meal planner';
	if (preset === 'full_access') return 'Full access';
	return 'Custom';
};

export const selectedMcpScopesForLevels = (
	scopeLevels: Record<string, McpScopeLevel>
): McpScope[] =>
	mcpScopeGroups.flatMap((group) => {
		const level = scopeLevels[group.id] ?? 'none';
		if (level === 'none') return [];
		if (level === 'read') return group.read ? [group.read] : [];
		return [group.read, group.write].filter((scope): scope is McpScope => Boolean(scope));
	});

export const selectedMcpHouseholds = (
	households: SettingsHousehold[],
	householdIds: string[]
): SettingsHousehold[] => households.filter((household) => householdIds.includes(household.id));

export const mcpHouseholdPickerLabel = (households: SettingsHousehold[]): string => {
	if (households.length === 0) return 'Select households';
	if (households.length === 1) return households[0].name;
	return `${households.length} households selected`;
};

export const filterMcpHouseholds = (
	households: SettingsHousehold[],
	query: string
): SettingsHousehold[] => {
	const normalizedQuery = query.trim().toLowerCase();
	return normalizedQuery
		? households.filter((household) => household.name.toLowerCase().includes(normalizedQuery))
		: households;
};

export const toggleMcpHouseholdId = (
	householdIds: string[],
	householdId: string,
	checked: boolean
): string[] =>
	checked
		? [...new Set([...householdIds, householdId])]
		: householdIds.filter((id) => id !== householdId);

export const setMcpScopeReadLevel = (
	scopeLevels: Record<string, McpScopeLevel>,
	groupId: string,
	checked: boolean
): Record<string, McpScopeLevel> => {
	const currentLevel = scopeLevels[groupId] ?? 'none';
	if (currentLevel === 'write') return scopeLevels;
	return { ...scopeLevels, [groupId]: checked ? 'read' : 'none' };
};

export const setMcpScopeWriteLevel = (
	scopeLevels: Record<string, McpScopeLevel>,
	groupId: string,
	checked: boolean
): Record<string, McpScopeLevel> => ({ ...scopeLevels, [groupId]: checked ? 'write' : 'read' });

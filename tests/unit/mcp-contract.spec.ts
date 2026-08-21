import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
	MAAL_API_SCOPES,
	MCP_KEY_PRESETS,
	presetScopes,
	schemaForToolList,
	tools
} from '$lib/server/mcp/index.js';

const expectedTools = [
	'list_user_households',
	'list_user_recipes',
	'get_user_recipe',
	'create_user_recipe',
	'update_user_recipe',
	'delete_user_recipe',
	'list_household_plan',
	'create_household_meal',
	'create_household_meals',
	'get_household_meal',
	'update_household_meal',
	'delete_household_meal',
	'create_meal_check_in'
] as const;

const sourceFiles = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map((entry) => {
				const path = join(directory, entry.name);
				return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
			})
		)
	).flat();
};

describe('public MCP contract', () => {
	test('preserves exact tool order, scope order, and presets', () => {
		expect(tools.map(({ name }) => name)).toEqual(expectedTools);
		expect(MAAL_API_SCOPES).toEqual([
			'households:read',
			'households:write',
			'recipes:read',
			'recipes:write',
			'meals:read',
			'meals:write',
			'check_ins:read',
			'check_ins:write',
			'food_profile:read',
			'food_profile:write'
		]);
		expect(MCP_KEY_PRESETS).toEqual(['read_only_planner', 'meal_planner', 'full_access']);
		expect(Object.fromEntries(MCP_KEY_PRESETS.map((preset) => [preset, presetScopes(preset)])))
			.toMatchInlineSnapshot(`
			{
			  "full_access": [
			    "households:read",
			    "households:write",
			    "recipes:read",
			    "recipes:write",
			    "meals:read",
			    "meals:write",
			    "check_ins:read",
			    "check_ins:write",
			    "food_profile:read",
			    "food_profile:write",
			  ],
			  "meal_planner": [
			    "households:read",
			    "recipes:read",
			    "meals:read",
			    "meals:write",
			    "check_ins:write",
			  ],
			  "read_only_planner": [
			    "households:read",
			    "recipes:read",
			    "meals:read",
			  ],
			}
		`);
	});

	test('snapshots every advertised Effect-derived JSON Schema and annotation', () => {
		expect(
			tools.map(({ name, inputSchema, annotations }) => ({
				name,
				inputSchema: schemaForToolList(inputSchema),
				annotations
			}))
		).toMatchSnapshot();
	});

	test('does not restore sessionful or SDK-v1 application APIs', async () => {
		const forbidden = [
			'Mcp' + 'Agent',
			'createLegacy' + 'McpHandler',
			'Worker' + 'Transport',
			'Mcp-' + 'Session-Id',
			'WebStandardStreamable' + 'HTTPServerTransport',
			'@modelcontextprotocol/' + 'sdk/server/',
			'routeAgent' + 'Request'
		];
		const files = (await sourceFiles('src')).filter((path) => /\.(?:ts|svelte)$/.test(path));
		const matches: string[] = [];
		for (const path of files) {
			const source = await readFile(path, 'utf8');
			for (const token of forbidden) {
				if (source.includes(token)) matches.push(`${path}: ${token}`);
			}
		}
		expect(matches).toEqual([]);
	});
});

import { describe, expect, it } from 'vitest';
import {
	filterMcpHouseholds,
	mcpHouseholdPickerLabel,
	selectedMcpHouseholds,
	selectedMcpScopesForLevels,
	setMcpScopeReadLevel,
	setMcpScopeWriteLevel,
	toggleMcpHouseholdId
} from './mcp-key-model';
import type { SettingsHousehold } from './types';

const households: SettingsHousehold[] = [
	{ id: 'h1', name: 'Kitchen' },
	{ id: 'h2', name: 'Studio' }
];

describe('MCP key model', () => {
	it('derives selected scopes from scope levels', () => {
		expect(
			selectedMcpScopesForLevels({ households: 'read', meals: 'write', recipes: 'none' })
		).toEqual(['households:read', 'meals:read', 'meals:write']);
	});

	it('selects, labels, and filters households', () => {
		expect(selectedMcpHouseholds(households, ['h2'])).toEqual([households[1]]);
		expect(mcpHouseholdPickerLabel([])).toBe('Select households');
		expect(mcpHouseholdPickerLabel([households[0]])).toBe('Kitchen');
		expect(mcpHouseholdPickerLabel(households)).toBe('2 households selected');
		expect(filterMcpHouseholds(households, 'kit')).toEqual([households[0]]);
	});

	it('updates household ids and scope levels', () => {
		expect(toggleMcpHouseholdId(['h1'], 'h2', true)).toEqual(['h1', 'h2']);
		expect(toggleMcpHouseholdId(['h1', 'h2'], 'h1', false)).toEqual(['h2']);
		expect(setMcpScopeReadLevel({ meals: 'none' }, 'meals', true)).toEqual({ meals: 'read' });
		expect(setMcpScopeReadLevel({ meals: 'write' }, 'meals', false)).toEqual({ meals: 'write' });
		expect(setMcpScopeWriteLevel({ meals: 'read' }, 'meals', true)).toEqual({ meals: 'write' });
		expect(setMcpScopeWriteLevel({ meals: 'write' }, 'meals', false)).toEqual({ meals: 'read' });
	});

	it('ignores unknown scope group ids at runtime', () => {
		const levels = { meals: 'read' } as const;
		expect(setMcpScopeReadLevel(levels, 'unknown' as never, true)).toBe(levels);
		expect(setMcpScopeWriteLevel(levels, 'unknown' as never, true)).toBe(levels);
	});
});

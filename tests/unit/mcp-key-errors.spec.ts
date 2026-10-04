import { beforeAll, describe, expect, test } from 'vitest';

import { McpKeyAuthRequired, McpKeyRequestFailed } from '$lib/client/mcp-keys.js';
import { mcpKeyErrorMessage, mcpKeyLabelError } from '$lib/components/settings/mcp-key-errors.js';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

beforeAll(() => overwriteGetLocale(() => 'en'));

describe('MCP key error messages', () => {
	test.each([
		['household_forbidden', 'You can only scope MCP keys to your households.'],
		['household_required', 'Choose at least one household.'],
		['not_found', 'MCP key not found.'],
		['mcp_key_storage_unavailable', 'MCP key storage is not available.'],
		[
			'McpKeyLimitError',
			'You have reached the MCP key limit. Revoke an unused key, or try again tomorrow.'
		],
		['no_remote_service', 'MCP keys need a household with an active subscription.']
	])('explains the %s server code', (code, message) => {
		expect(
			mcpKeyErrorMessage(new McpKeyRequestFailed(code), m.settings_mcp_key_could_not_create)
		).toBe(message);
	});

	test('asks the profile to sign in again when its session is gone', () => {
		expect(mcpKeyErrorMessage(new McpKeyAuthRequired(), m.settings_mcp_keys_could_not_load)).toBe(
			'Sign in to this profile again to manage MCP keys.'
		);
	});

	test.each([
		['x', 'Give this MCP key a label.'],
		['x'.repeat(81), 'Keep the MCP key label under 80 characters.'],
		['  Laptop  ', null]
	])('checks the label %#', (label, message) => {
		expect(mcpKeyLabelError(label)).toBe(message);
	});

	test('falls back to the action-specific message for unknown failures', () => {
		expect(
			mcpKeyErrorMessage(new McpKeyRequestFailed('HTTP 502'), m.settings_mcp_key_could_not_revoke)
		).toBe('Could not revoke the MCP key. Try again.');
		expect(mcpKeyErrorMessage(new TypeError('offline'), m.settings_mcp_keys_could_not_load)).toBe(
			'Could not load MCP keys. Try again.'
		);
	});
});

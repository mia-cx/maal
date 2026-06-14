import { resolve } from '$app/paths';
import { readSettingsError } from '$lib/settings/api-client';
import type { McpKey, McpScope } from '$lib/settings/mcp-key-model';
import type { SettingsHousehold } from '$lib/settings/types';

export const loadMcpKeys = async (): Promise<
	{ ok: true; keys: McpKey[]; households: SettingsHousehold[] } | { ok: false; error: string }
> => {
	const response = await fetch(resolve('/settings/mcp-keys'));
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'Could not load MCP keys.') };
	}
	return {
		ok: true,
		...((await response.json()) as { keys: McpKey[]; households: SettingsHousehold[] })
	};
};

export const createMcpKey = async ({
	label,
	scopes,
	householdScope
}: {
	label: string;
	scopes: McpScope[];
	householdScope: { kind: 'all' } | { kind: 'households'; householdIds: string[] };
}): Promise<{ ok: true; key: string; record: McpKey } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/mcp-keys'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ label, scopes, householdScope })
	});
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'Could not create MCP key.') };
	}
	return { ok: true, ...((await response.json()) as { key: string; record: McpKey }) };
};

export const rerollMcpKey = async (
	keyId: string
): Promise<{ ok: true; key: string; record: McpKey } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/mcp-keys'), {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ keyId })
	});
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'Could not reroll MCP key.') };
	}
	return { ok: true, ...((await response.json()) as { key: string; record: McpKey }) };
};

export const revokeMcpKey = async (
	keyId: string
): Promise<{ ok: true } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/mcp-keys'), {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ keyId })
	});
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'Could not revoke MCP key.') };
	}
	return { ok: true };
};

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import McpCreatedKeyPanel from '$lib/components/settings/mcp-created-key-panel.svelte';
	import McpKeyForm from '$lib/components/settings/mcp-key-form.svelte';
	import McpKeyList from '$lib/components/settings/mcp-key-list.svelte';
	import { Button } from '$lib/components/ui/button';
	import type {
		McpKey,
		McpScope,
		McpScopeGroupId,
		McpScopeLevels
	} from '$lib/settings/mcp-key-model';
	import type { SettingsHousehold } from '$lib/settings/types';

	let {
		mcpServerUrl,
		mcpKeys,
		mcpKeysBusy,
		rerollingMcpKeyId,
		revokingMcpKeyId,
		createdMcpKey,
		mcpKeyFormOpen = $bindable(false),
		mcpKeyLabel = $bindable(''),
		mcpKeyHouseholdKind = $bindable<'all' | 'households'>('households'),
		mcpHouseholdPickerOpen = $bindable(false),
		mcpHouseholdQuery = $bindable(''),
		mcpKeyCreating,
		selectedMcpScopes,
		mcpKeyHouseholdIds,
		mcpScopeLevels,
		mcpHouseholdPickerLabel,
		filteredMcpHouseholds,
		mcpMessage,
		mcpError,
		loadMcpKeys,
		rerollMcpAccessKey,
		confirmRevokeMcpKey,
		copyCreatedMcpKey,
		setMcpScopeRead,
		setMcpScopeWrite,
		toggleMcpHousehold,
		createMcpAccessKey
	}: {
		mcpServerUrl: string;
		mcpKeys: McpKey[];
		mcpKeysBusy: boolean;
		rerollingMcpKeyId: string | null;
		revokingMcpKeyId: string | null;
		createdMcpKey: string | null;
		mcpKeyFormOpen: boolean;
		mcpKeyLabel: string;
		mcpKeyHouseholdKind: 'all' | 'households';
		mcpHouseholdPickerOpen: boolean;
		mcpHouseholdQuery: string;
		mcpKeyCreating: boolean;
		selectedMcpScopes: McpScope[];
		mcpKeyHouseholdIds: string[];
		mcpScopeLevels: McpScopeLevels;
		mcpHouseholdPickerLabel: string;
		filteredMcpHouseholds: SettingsHousehold[];
		mcpMessage: string | null;
		mcpError: string | null;
		loadMcpKeys: (force?: boolean) => void | Promise<void>;
		rerollMcpAccessKey: (key: McpKey) => void | Promise<void>;
		confirmRevokeMcpKey: (key: McpKey) => void | Promise<void>;
		copyCreatedMcpKey: () => void | Promise<void>;
		setMcpScopeRead: (groupId: McpScopeGroupId, checked: boolean) => void;
		setMcpScopeWrite: (groupId: McpScopeGroupId, checked: boolean) => void;
		toggleMcpHousehold: (householdId: string, checked: boolean) => void;
		createMcpAccessKey: () => void | Promise<void>;
	} = $props();

	let mcpServerCopyError = $state<string | null>(null);

	const copyMcpServerUrl = async () => {
		mcpServerCopyError = null;
		try {
			await navigator.clipboard.writeText(mcpServerUrl);
		} catch (cause) {
			console.error('Failed to copy MCP server URL', cause);
			mcpServerCopyError = 'Could not copy the MCP server address.';
		}
	};
</script>

<div class="grid max-w-lg gap-5 text-sm">
	<div class="grid gap-2 rounded-md border border-border bg-muted/30 p-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-medium">{m.settings_mcp_server_address()}</p>
				<p class="text-xs text-muted-foreground">
					{m.settings_use_this_url_when_connecting_claude_desktop_()}
				</p>
			</div>
			<Button variant="outline" size="sm" onclick={copyMcpServerUrl}>{m.settings_copy()}</Button>
		</div>
		<code class="overflow-x-auto rounded bg-background px-2 py-1.5 text-xs">{mcpServerUrl}</code>
		{#if mcpServerCopyError}<p class="text-xs text-destructive">{mcpServerCopyError}</p>{/if}
	</div>

	<McpKeyList
		{mcpKeys}
		{mcpKeysBusy}
		{rerollingMcpKeyId}
		{revokingMcpKeyId}
		{loadMcpKeys}
		{rerollMcpAccessKey}
		{confirmRevokeMcpKey}
		openCreateForm={() => (mcpKeyFormOpen = true)}
	/>
	{#if createdMcpKey}
		<McpCreatedKeyPanel {createdMcpKey} {copyCreatedMcpKey} />
	{/if}
	{#if mcpKeyFormOpen}
		<McpKeyForm
			bind:mcpKeyLabel
			bind:mcpKeyHouseholdKind
			bind:mcpHouseholdPickerOpen
			bind:mcpHouseholdQuery
			{mcpKeyCreating}
			{selectedMcpScopes}
			{mcpKeyHouseholdIds}
			{mcpScopeLevels}
			{mcpHouseholdPickerLabel}
			{filteredMcpHouseholds}
			{setMcpScopeRead}
			{setMcpScopeWrite}
			{toggleMcpHousehold}
			cancel={() => (mcpKeyFormOpen = false)}
			{createMcpAccessKey}
		/>
	{/if}
	{#if mcpMessage}<p class="text-xs text-muted-foreground">{mcpMessage}</p>{/if}
	{#if mcpError}<p class="text-xs text-destructive">{mcpError}</p>{/if}
</div>

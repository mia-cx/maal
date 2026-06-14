<script lang="ts">
	import McpCreatedKeyPanel from '$lib/components/settings/mcp-created-key-panel.svelte';
	import McpKeyForm from '$lib/components/settings/mcp-key-form.svelte';
	import McpKeyList from '$lib/components/settings/mcp-key-list.svelte';
	import type { McpKey, McpScope, McpScopeLevel } from '$lib/settings/mcp-key-model';
	import type { SettingsHousehold } from '$lib/settings/types';

	let {
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
		mcpScopeLevels: Record<string, McpScopeLevel>;
		mcpHouseholdPickerLabel: string;
		filteredMcpHouseholds: SettingsHousehold[];
		mcpMessage: string | null;
		mcpError: string | null;
		loadMcpKeys: (force?: boolean) => void;
		rerollMcpAccessKey: (key: McpKey) => void;
		confirmRevokeMcpKey: (key: McpKey) => void;
		copyCreatedMcpKey: () => void;
		setMcpScopeRead: (groupId: string, checked: boolean) => void;
		setMcpScopeWrite: (groupId: string, checked: boolean) => void;
		toggleMcpHousehold: (householdId: string, checked: boolean) => void;
		createMcpAccessKey: () => void;
	} = $props();
</script>

<div class="grid max-w-lg gap-5 text-sm">
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

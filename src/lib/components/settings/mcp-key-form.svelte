<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import McpHouseholdAccessPicker from '$lib/components/settings/mcp-household-access-picker.svelte';
	import McpPermissionsEditor from '$lib/components/settings/mcp-permissions-editor.svelte';
	import type { McpScope, McpScopeGroupId, McpScopeLevels } from '$lib/settings/mcp-key-model';
	import type { SettingsHousehold } from '$lib/settings/types';

	let {
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
		setMcpScopeRead,
		setMcpScopeWrite,
		toggleMcpHousehold,
		cancel,
		createMcpAccessKey
	}: {
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
		setMcpScopeRead: (groupId: McpScopeGroupId, checked: boolean) => void;
		setMcpScopeWrite: (groupId: McpScopeGroupId, checked: boolean) => void;
		toggleMcpHousehold: (householdId: string, checked: boolean) => void;
		cancel: () => void;
		createMcpAccessKey: () => void | Promise<void>;
	} = $props();
</script>

<div class="grid gap-3">
	<div>
		<p class="text-xs font-medium">{m.settings_create_mcp_key()}</p>
		<p class="text-xs text-muted-foreground">
			{m.settings_choose_permissions_and_household_access()}
		</p>
	</div>
	<label class="grid gap-1 text-xs font-medium">
		{m.settings_label()}
		<Input bind:value={mcpKeyLabel} placeholder={m.settings_claude_on_my_laptop()} class="h-8" />
	</label>
	<McpPermissionsEditor {mcpScopeLevels} {setMcpScopeRead} {setMcpScopeWrite} />
	<McpHouseholdAccessPicker
		bind:mcpKeyHouseholdKind
		bind:mcpHouseholdPickerOpen
		bind:mcpHouseholdQuery
		{mcpHouseholdPickerLabel}
		{filteredMcpHouseholds}
		{mcpKeyHouseholdIds}
		{toggleMcpHousehold}
	/>
	<div class="flex justify-end gap-2">
		<Button variant="ghost" disabled={mcpKeyCreating} onclick={cancel}>{m.settings_cancel()}</Button
		>
		<Button
			disabled={mcpKeyCreating ||
				!mcpKeyLabel.trim() ||
				!selectedMcpScopes.length ||
				(mcpKeyHouseholdKind === 'households' && !mcpKeyHouseholdIds.length)}
			onclick={createMcpAccessKey}
		>
			{mcpKeyCreating ? 'Creating…' : 'Create MCP key'}
		</Button>
	</div>
</div>

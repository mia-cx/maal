<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import McpHouseholdAccessPicker from '$lib/components/settings/mcp-household-access-picker.svelte';
	import McpPermissionsEditor from '$lib/components/settings/mcp-permissions-editor.svelte';
	import {
		presetLabel,
		type McpKeyPreset,
		type McpScope,
		type McpScopeGroupId,
		type McpScopeLevels
	} from '$lib/settings/mcp-key-model';
	import type { SettingsHousehold } from '$lib/settings/types';

	let {
		mcpKeyLabel = $bindable(''),
		mcpKeyPreset = $bindable<'custom' | McpKeyPreset>('read_only_planner'),
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
		setMcpPreset,
		toggleMcpHousehold,
		cancel,
		createMcpAccessKey
	}: {
		mcpKeyLabel: string;
		mcpKeyPreset: 'custom' | McpKeyPreset;
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
		setMcpPreset: (preset: 'custom' | McpKeyPreset) => void;
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
	<label class="grid gap-1 text-xs font-medium">
		Permission preset
		<Select.Root
			type="single"
			value={mcpKeyPreset}
			onValueChange={(value) => setMcpPreset((value ?? 'custom') as 'custom' | McpKeyPreset)}
		>
			<Select.Trigger class="!h-8 w-full text-xs">
				{mcpKeyPreset === 'custom' ? 'Custom' : presetLabel(mcpKeyPreset)}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="read_only_planner">Read-only planner</Select.Item>
				<Select.Item value="meal_planner">Meal planner</Select.Item>
				<Select.Item value="full_access">Full access</Select.Item>
				<Select.Item value="custom">Custom</Select.Item>
			</Select.Content>
		</Select.Root>
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

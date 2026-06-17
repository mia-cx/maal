<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		mcpScopeGroups,
		type McpScopeGroupId,
		type McpScopeLevels
	} from '$lib/settings/mcp-key-model';

	let {
		mcpScopeLevels,
		setMcpScopeRead,
		setMcpScopeWrite
	}: {
		mcpScopeLevels: McpScopeLevels;
		setMcpScopeRead: (groupId: McpScopeGroupId, checked: boolean) => void;
		setMcpScopeWrite: (groupId: McpScopeGroupId, checked: boolean) => void;
	} = $props();
</script>

<div class="grid gap-2 text-xs">
	<div>
		<p class="font-medium">{m.settings_permissions()}</p>
		<p class="text-muted-foreground">{m.settings_write_automatically_includes_read()}</p>
	</div>
	<div class="grid gap-2">
		{#each mcpScopeGroups as group (group.id)}
			{@const level = mcpScopeLevels[group.id] ?? 'none'}
			<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<div class="min-w-0">
					<p class="font-medium">{group.label}</p>
					<p class="text-muted-foreground">{group.description}</p>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					{#if group.read}
						<label class="flex items-center gap-2 px-1 py-1">
							<Checkbox
								checked={level === 'read' || level === 'write'}
								disabled={level === 'write'}
								onCheckedChange={(checked) => setMcpScopeRead(group.id, checked === true)}
							/>
							<span>{m.settings_read()}</span>
						</label>
					{/if}
					{#if group.write}
						<label class="flex items-center gap-2 px-1 py-1">
							<Checkbox
								checked={level === 'write'}
								onCheckedChange={(checked) => setMcpScopeWrite(group.id, checked === true)}
							/>
							<span>{m.settings_write()}</span>
						</label>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

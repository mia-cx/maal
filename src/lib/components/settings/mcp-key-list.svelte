<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import McpKeyListItem from '$lib/components/settings/mcp-key-list-item.svelte';
	import type { McpKey } from '$lib/settings/mcp-key-model';

	let {
		mcpKeys,
		mcpKeysBusy,
		rerollingMcpKeyId,
		revokingMcpKeyId,
		loadMcpKeys,
		rerollMcpAccessKey,
		confirmRevokeMcpKey,
		openCreateForm
	}: {
		mcpKeys: McpKey[];
		mcpKeysBusy: boolean;
		rerollingMcpKeyId: string | null;
		revokingMcpKeyId: string | null;
		loadMcpKeys: (force?: boolean) => void | Promise<void>;
		rerollMcpAccessKey: (key: McpKey) => void | Promise<void>;
		confirmRevokeMcpKey: (key: McpKey) => void | Promise<void>;
		openCreateForm: () => void;
	} = $props();
</script>

<div class="grid gap-2">
	<div class="flex items-start justify-between gap-3">
		<div>
			<p class="text-xs font-medium">MCP keys</p>
			<p class="text-xs text-muted-foreground">
				Use MCP keys in clients like Claude Desktop or Inspector.
			</p>
		</div>
		<Button size="sm" onclick={openCreateForm}>Create MCP key</Button>
	</div>
	{#if mcpKeysBusy}
		<p class="text-xs text-muted-foreground">Loading MCP keys…</p>
	{:else if mcpKeys.length === 0}
		<p class="text-xs text-muted-foreground">No MCP keys yet.</p>
	{:else}
		<ul class="divide-y rounded-md border border-border">
			{#each mcpKeys as key (key.id)}
				<McpKeyListItem
					keyRecord={key}
					{rerollingMcpKeyId}
					{revokingMcpKeyId}
					{rerollMcpAccessKey}
					{confirmRevokeMcpKey}
				/>
			{/each}
		</ul>
	{/if}
	<div class="flex justify-end">
		<Button variant="ghost" size="sm" disabled={mcpKeysBusy} onclick={() => loadMcpKeys(true)}>
			Refresh
		</Button>
	</div>
</div>

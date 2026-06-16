<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { presetLabel, type McpKey } from '$lib/settings/mcp-key-model';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';

	let {
		keyRecord,
		rerollingMcpKeyId,
		revokingMcpKeyId,
		rerollMcpAccessKey,
		confirmRevokeMcpKey
	}: {
		keyRecord: McpKey;
		rerollingMcpKeyId: string | null;
		revokingMcpKeyId: string | null;
		rerollMcpAccessKey: (key: McpKey) => void | Promise<void>;
		confirmRevokeMcpKey: (key: McpKey) => void | Promise<void>;
	} = $props();
</script>

<li class="flex items-center justify-between gap-3 px-3 py-2">
	<div class="min-w-0">
		<p class="truncate text-xs font-medium">{keyRecord.label}</p>
		<p class="truncate text-xs text-muted-foreground">
			{presetLabel(keyRecord.preset)} · {keyRecord.householdScope.kind === 'all'
				? 'All households'
				: `${keyRecord.householdScope.householdIds.length} households`}
			{#if keyRecord.revokedAt}
				· Revoked{/if}
		</p>
	</div>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={Boolean(keyRecord.revokedAt) ||
						rerollingMcpKeyId === keyRecord.id ||
						revokingMcpKeyId === keyRecord.id}
					aria-label={`Open actions for ${keyRecord.label}`}
				>
					<EllipsisIcon class="size-4" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end">
			<DropdownMenu.Item onclick={() => rerollMcpAccessKey(keyRecord)}>
				{rerollingMcpKeyId === keyRecord.id ? 'Rerolling…' : 'Reroll key'}
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item variant="destructive" onclick={() => confirmRevokeMcpKey(keyRecord)}>
				{revokingMcpKeyId === keyRecord.id ? 'Revoking…' : 'Revoke key'}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</li>

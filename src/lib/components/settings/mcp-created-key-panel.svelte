<script lang="ts">
	import { Button } from '$lib/components/ui/button';

	let {
		createdMcpKey,
		copyCreatedMcpKey
	}: { createdMcpKey: string; copyCreatedMcpKey: () => void } = $props();
</script>

<div class="grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
	<p class="font-medium">Copy this MCP key now. It will not be shown again.</p>
	<code class="rounded bg-background p-2 break-all">{createdMcpKey}</code>
	<Button variant="outline" size="sm" onclick={copyCreatedMcpKey}>Copy MCP key</Button>
</div>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';

	let {
		createdMcpKey,
		copyCreatedMcpKey
	}: { createdMcpKey: string; copyCreatedMcpKey: () => void } = $props();
</script>

<div class="grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
	<p class="font-medium">{m.settings_copy_this_mcp_key_now_it_will_not_be_shown_a()}</p>
	<code class="rounded bg-background p-2 break-all">{createdMcpKey}</code>
	<Button variant="outline" size="sm" onclick={copyCreatedMcpKey}
		>{m.settings_copy_mcp_key()}</Button
	>
</div>

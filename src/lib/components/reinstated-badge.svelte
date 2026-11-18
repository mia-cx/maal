<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';

	let { class: className }: { class?: string } = $props();
</script>

<!-- Marks a recipe or meal that a recent edit brought back after it was deleted (spec §8.5). -->
<Badge class={className}>Reinstated</Badge>

<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import type { Meal } from './schedule-types';

	let { meal, compact = false }: { meal: Meal; compact?: boolean } = $props();
</script>

<Card.Root
	size="sm"
	class="relative min-w-0 gap-1 bg-card/40 py-1 shadow-none ring-0 after:absolute after:inset-y-1 after:left-0 after:w-px after:bg-card-foreground/80 after:content-['']"
>
	<Card.Content class="pr-2 pl-3">
		<div class="truncate text-sm font-medium">{meal.title}</div>
		<div class="truncate text-sm text-muted-foreground">{meal.time}</div>
		{#if !compact}
			<p class="mt-2 line-clamp-2 text-sm text-muted-foreground">Placeholder meal record.</p>
		{/if}
	</Card.Content>
</Card.Root>

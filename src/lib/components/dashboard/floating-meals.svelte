<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import type { Meal } from './schedule-types';

	let { meals }: { meals: Meal[] } = $props();
</script>

<section class="min-w-0 overflow-hidden">
	<div class="flex min-w-0 gap-2 overflow-x-auto px-3 py-2">
		{#each meals as meal (meal.id)}
			<Card.Root size="sm" class="w-44 shrink-0 gap-1 py-2 shadow-sm">
				<Card.Content>
					<div class="truncate text-sm leading-tight font-medium">{meal.title}</div>
					<div class="mt-1 text-xs text-muted-foreground">Floating</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</section>

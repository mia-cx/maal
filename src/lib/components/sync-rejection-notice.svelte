<script lang="ts">
	import { liveQuery } from 'dexie';

	import type { MaalDatabase } from '$lib/client/local/database.js';
	import {
		markRejectionsSeen,
		readUnseenRejections,
		type RejectionNotice
	} from '$lib/client/sync/rejections.js';
	import { Button } from '$lib/components/ui/button/index.js';

	const visibleMessages = 3;

	let { database }: { database: MaalDatabase } = $props();

	let notices = $state<RejectionNotice[]>([]);

	$effect(() => {
		const opened = database;
		const subscription = liveQuery(() => readUnseenRejections(opened)).subscribe({
			next: (value) => (notices = value),
			error: () => (notices = [])
		});
		return () => subscription.unsubscribe();
	});

	const shown = $derived(notices.slice(0, visibleMessages));
	const hiddenCount = $derived(notices.length - shown.length);
</script>

{#if notices.length > 0}
	<aside
		class="fixed right-3 bottom-3 z-[100] grid w-[min(24rem,calc(100vw-1.5rem))] gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
		aria-live="polite"
		data-testid="sync-rejection-notice"
	>
		<div class="grid gap-1">
			<p class="text-sm font-medium">
				{notices.length === 1 ? 'Change not saved' : `${notices.length} changes not saved`}
			</p>
			{#each shown as notice (notice.mutationId)}
				<p class="text-xs text-muted-foreground">{notice.message}</p>
			{/each}
			{#if hiddenCount > 0}
				<p class="text-xs text-muted-foreground">
					{hiddenCount === 1
						? '1 more change wasn’t saved.'
						: `${hiddenCount} more changes weren’t saved.`}
				</p>
			{/if}
		</div>
		<!-- Dismissing marks only the shown messages, so the hidden ones show next. -->
		<Button
			variant="outline"
			size="sm"
			onclick={() =>
				void markRejectionsSeen(
					database,
					shown.map(({ mutationId }) => mutationId)
				)}
		>
			Dismiss
		</Button>
	</aside>
{/if}

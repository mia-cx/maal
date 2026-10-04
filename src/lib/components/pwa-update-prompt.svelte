<script lang="ts">
	import { onMount } from 'svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	import {
		getPwaUpdateCoordinator,
		type PwaUpdateState
	} from '$lib/client/pwa/update-coordinator.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let state = $state<PwaUpdateState>({
		status: 'idle',
		version: null,
		critical: false,
		message: null
	});

	onMount(() => {
		const coordinator = getPwaUpdateCoordinator();
		const unsubscribe = coordinator.subscribe((next) => (state = next));
		void coordinator.start();
		return unsubscribe;
	});
</script>

{#if state.status !== 'idle'}
	<aside
		class="fixed right-3 bottom-3 z-[100] grid w-[min(24rem,calc(100vw-1.5rem))] gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
		aria-live="polite"
	>
		<div class="grid gap-1">
			<p class="text-sm font-medium">
				{state.status === 'reload-required' ? 'Reload required' : 'Maal update ready'}
			</p>
			<p class="text-xs text-muted-foreground">
				{state.message ?? 'Reload once every open tab has safely finished its local changes.'}
			</p>
		</div>
		{#if state.status === 'available'}
			<Button size="sm" onclick={() => void getPwaUpdateCoordinator().activate()}>
				<RefreshCwIcon /> Reload and update
			</Button>
		{:else if state.status === 'reload-required'}
			<Button size="sm" onclick={() => window.location.reload()}>
				<RefreshCwIcon /> Reload Maal
			</Button>
		{/if}
	</aside>
{/if}

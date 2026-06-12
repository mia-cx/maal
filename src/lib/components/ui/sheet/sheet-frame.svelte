<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';

	let {
		leadIn = 0,
		closeLabel = 'Close sheet',
		onclose,
		children,
		footer
	}: {
		leadIn?: number;
		closeLabel?: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<button
	type="button"
	aria-label={closeLabel}
	tabindex="-1"
	class="fixed inset-0 z-0 cursor-default bg-transparent"
	onclick={onclose}
></button>
<div class="pointer-events-none relative z-10 w-full sm:mx-auto sm:max-w-[42rem] sm:px-4">
	<div
		class="h-svh [scrollbar-width:none] overflow-y-auto rounded-none sm:my-4 sm:h-[calc(100svh-2rem)] sm:rounded-xl [&::-webkit-scrollbar]:hidden"
	>
		<div
			class="pt-0 sm:pt-[var(--sheet-lead-in)]"
			style={`--sheet-lead-in: min(${leadIn}px, 33svh);`}
		>
			<div class="pointer-events-none sticky top-0 z-30 h-0">
				<Dialog.Close
					aria-label={closeLabel}
					class="pointer-events-auto absolute top-3 right-3 inline-flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-black text-white shadow-lg transition after:absolute after:inset-0 after:bg-white/20 after:opacity-0 after:transition-opacity after:content-[''] hover:after:opacity-100 focus-visible:ring-2 focus-visible:ring-black/60 focus-visible:outline-none dark:bg-white dark:text-black dark:after:bg-black/20 dark:focus-visible:ring-white/60"
				>
					<XIcon class="relative z-10 size-5" />
				</Dialog.Close>
			</div>
			<div
				class={`pointer-events-auto relative bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 ${footer ? 'sm:rounded-t-xl sm:border sm:border-b-0 sm:border-border' : 'sm:rounded-xl sm:border sm:border-border'}`}
			>
				{@render children()}
			</div>
			{#if footer}
				<div
					class="pointer-events-auto sticky bottom-0 z-20 bg-popover/95 shadow-[0_-12px_24px_-18px_rgba(0,0,0,0.45)] backdrop-blur sm:rounded-b-xl sm:border-x sm:border-b sm:border-border"
				>
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
</div>

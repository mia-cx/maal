<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';

	let {
		leadIn = 0,
		gutter = 16,
		closeLabel = 'Close sheet',
		onclose,
		children
	}: {
		leadIn?: number;
		gutter?: number;
		closeLabel?: string;
		onclose: () => void;
		children: Snippet;
	} = $props();

	let shellElement = $state<HTMLElement>();
	let scrollElement = $state<HTMLElement>();
	let pinned = $state(false);
	let trackHeight = $state(0);

	const pinnedHeight = $derived(`calc(100svh - ${gutter * 2}px)`);
	const shellStyle = $derived(`top: ${gutter}px; ${pinned ? `max-height: ${pinnedHeight};` : ''}`);
	const scrollStyle = $derived(pinned ? `max-height: ${pinnedHeight};` : '');
	const shellClipClass = $derived(pinned ? 'overflow-hidden' : 'overflow-visible');
	const scrollClass = $derived(
		pinned
			? 'overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
			: 'overflow-visible'
	);
	const trackStyle = $derived(trackHeight > 0 ? `min-height: ${trackHeight}px;` : '');

	$effect(() => {
		const content = scrollElement;
		if (!content) return;

		const updateTrackHeight = () => {
			trackHeight = content.scrollHeight;
		};
		const observer = new ResizeObserver(updateTrackHeight);
		observer.observe(content);
		updateTrackHeight();

		return () => observer.disconnect();
	});

	$effect(() => {
		const shell = shellElement;
		const viewport = shell?.closest('[data-sheet-viewport]');
		if (!shell || !(viewport instanceof HTMLElement)) return;

		const updatePinned = () => {
			const viewportTop = viewport.getBoundingClientRect().top;
			pinned = shell.getBoundingClientRect().top <= viewportTop + gutter + 0.5;
		};

		updatePinned();
		viewport.addEventListener('scroll', updatePinned, { passive: true });
		window.visualViewport?.addEventListener('resize', updatePinned);
		window.addEventListener('resize', updatePinned);

		return () => {
			viewport.removeEventListener('scroll', updatePinned);
			window.visualViewport?.removeEventListener('resize', updatePinned);
			window.removeEventListener('resize', updatePinned);
		};
	});
</script>

<button
	type="button"
	aria-label={closeLabel}
	tabindex="-1"
	class="fixed inset-0 z-0 cursor-default bg-transparent"
	onclick={onclose}
></button>
<div
	class="pointer-events-none relative z-10 mx-auto w-full max-w-[min(100vw-1rem,42rem)] px-2 sm:max-w-[42rem] sm:px-4"
	style={`padding-top: ${leadIn}px;`}
>
	<div style={trackStyle}>
		<div
			bind:this={shellElement}
			class={`pointer-events-auto sticky rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 ${shellClipClass}`}
			style={shellStyle}
		>
			<Dialog.Close
				aria-label={closeLabel}
				class="absolute top-3 right-3 z-20 inline-flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-black text-white shadow-lg transition after:absolute after:inset-0 after:bg-white/20 after:opacity-0 after:transition-opacity after:content-[''] hover:after:opacity-100 focus-visible:ring-2 focus-visible:ring-black/60 focus-visible:outline-none dark:bg-white dark:text-black dark:after:bg-black/20 dark:focus-visible:ring-white/60"
			>
				<XIcon class="relative z-10 size-5" />
			</Dialog.Close>
			<div bind:this={scrollElement} class={scrollClass} style={scrollStyle}>
				{@render children()}
			</div>
		</div>
	</div>
</div>

<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';

	let {
		leadIn = 0,
		gutter = 16,
		closeLabel = 'Close sheet',
		onclose,
		children,
		footer
	}: {
		leadIn?: number;
		gutter?: number;
		closeLabel?: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	let trackElement = $state<HTMLElement>();
	let shellElement = $state<HTMLElement>();
	let bodyElement = $state<HTMLElement>();
	let footerElement = $state<HTMLElement>();
	let viewportHeight = $state(0);
	let bodyHeight = $state(0);
	let footerHeight = $state(0);
	let contentOffset = $state(0);
	let pinned = $state(false);

	const contentHeight = $derived(bodyHeight + footerHeight);
	const maxShellHeight = $derived(Math.max(240, viewportHeight - gutter * 2));
	const shellHeight = $derived(Math.min(contentHeight || maxShellHeight, maxShellHeight));
	const bodyMaskHeight = $derived(Math.max(0, shellHeight - footerHeight));
	const maxContentOffset = $derived(Math.max(0, bodyHeight - bodyMaskHeight));
	const trackStyle = $derived(contentHeight > 0 ? `min-height: ${contentHeight}px;` : '');
	const shellStyle = $derived(
		`top: ${gutter}px; ${pinned ? `height: ${shellHeight}px; overflow: hidden;` : ''}`
	);
	const bodyMaskStyle = $derived(pinned ? `height: ${bodyMaskHeight}px; overflow: hidden;` : '');
	const bodyStyle = $derived(pinned ? `transform: translate3d(0, -${contentOffset}px, 0);` : '');

	const clamp = (value: number, minimum: number, maximum: number) =>
		Math.min(maximum, Math.max(minimum, value));

	$effect(() => {
		const track = trackElement;
		const shell = shellElement;
		const body = bodyElement;
		const viewport = shell?.closest('[data-sheet-viewport]');
		if (!track || !shell || !body || !(viewport instanceof HTMLElement)) return;

		const updateMetrics = () => {
			viewportHeight = window.visualViewport?.height ?? window.innerHeight;
			bodyHeight = body.scrollHeight;
			footerHeight = footerElement?.offsetHeight ?? 0;

			const viewportTop = viewport.getBoundingClientRect().top;
			const trackTop = track.getBoundingClientRect().top - viewportTop + viewport.scrollTop;
			const pinStart = trackTop - gutter;
			const rawOffset = viewport.scrollTop - pinStart;
			pinned = rawOffset >= 0;
			contentOffset = pinned ? clamp(rawOffset, 0, maxContentOffset) : 0;
		};

		const observer = new ResizeObserver(updateMetrics);
		observer.observe(body);
		if (footerElement) observer.observe(footerElement);
		updateMetrics();
		viewport.addEventListener('scroll', updateMetrics, { passive: true });
		window.visualViewport?.addEventListener('resize', updateMetrics);
		window.addEventListener('resize', updateMetrics);

		return () => {
			observer.disconnect();
			viewport.removeEventListener('scroll', updateMetrics);
			window.visualViewport?.removeEventListener('resize', updateMetrics);
			window.removeEventListener('resize', updateMetrics);
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
	<div bind:this={trackElement} style={trackStyle}>
		<div
			bind:this={shellElement}
			class="pointer-events-auto sticky flex flex-col overflow-visible rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10"
			style={shellStyle}
		>
			<Dialog.Close
				aria-label={closeLabel}
				class="absolute top-3 right-3 z-20 inline-flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-black text-white shadow-lg transition after:absolute after:inset-0 after:bg-white/20 after:opacity-0 after:transition-opacity after:content-[''] hover:after:opacity-100 focus-visible:ring-2 focus-visible:ring-black/60 focus-visible:outline-none dark:bg-white dark:text-black dark:after:bg-black/20 dark:focus-visible:ring-white/60"
			>
				<XIcon class="relative z-10 size-5" />
			</Dialog.Close>
			<div style={bodyMaskStyle}>
				<div bind:this={bodyElement} style={bodyStyle}>
					{@render children()}
				</div>
			</div>
			{#if footer}
				<div bind:this={footerElement} class="shrink-0">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
</div>

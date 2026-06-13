<script lang="ts">
	import wordmark from '$lib/assets/Maal.svg?raw';
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	let { class: className, ...restProps }: HTMLAttributes<HTMLSpanElement> = $props();

	const inlineWordmark = wordmark
		.replace(/<\?xml[^>]*>/, '')
		.replace(/<!DOCTYPE[^>]*>/, '')
		.replace(/<defs>[\s\S]*?<\/defs>/, '')
		.replace(/<g[^>]*>\s*<use\b[\s\S]*?<\/g>/g, '')
		.replace(/<use\b[^>]*\/?>(?:<\/use>)?/g, '')
		.replace(/<svg\s/, '<svg aria-hidden="true" ')
		.replace('style="', 'style="color:currentColor;')
		.replaceAll('stroke:black', 'stroke:currentColor')
		.replaceAll('<path ', '<path fill="currentColor" ');
</script>

<span
	class={cn('wordmark-logo inline-flex shrink-0 [&_svg]:h-full [&_svg]:w-full', className)}
	{...restProps}
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html inlineWordmark}
</span>

<style>
	:global(.wordmark-logo svg) {
		color: inherit !important;
	}

	:global(.wordmark-logo path) {
		fill: currentColor !important;
		stroke: currentColor !important;
	}
</style>

<script lang="ts">
	import { cn } from '$lib/utils';
	import { ArrowRight, ArrowRightUp } from '@solar-icons/svelte/Outline';
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes } from 'svelte/elements';

	type AnchorProps = HTMLAnchorAttributes & {
		children: Snippet;
		showIcon?: boolean;
		class?: string;
	};

	let {
		children,
		href,
		showIcon = true,
		class: className,
		target,
		rel,
		...restProps
	}: AnchorProps = $props();

	const isRemote = $derived(!!href && (href.startsWith('http://') || href.startsWith('https://')));
	const isExternal = $derived(
		isRemote || !!href?.startsWith('mailto:') || !!href?.startsWith('tel:')
	);
	const resolvedTarget = $derived(target ?? (isRemote ? '_blank' : undefined));
	const resolvedRel = $derived(
		rel ?? (resolvedTarget === '_blank' ? 'noopener noreferrer' : undefined)
	);
</script>

<a
	{href}
	target={resolvedTarget}
	rel={resolvedRel}
	class={cn(
		'group inline-flex items-center transition-colors hover:text-foreground',
		isExternal ? 'gap-0.5' : 'gap-2 transition-all hover:gap-3',
		className
	)}
	{...restProps}
>
	<span class="inline-flex min-w-0 items-center">{@render children()}</span>
	{#if showIcon}
		{#if isExternal}
			<ArrowRightUp
				class="size-4 -translate-y-[10%] opacity-50 transition-opacity group-hover:opacity-100"
			/>
		{:else}
			<ArrowRight
				class="size-4 translate-y-[10%] opacity-50 transition-opacity group-hover:opacity-100"
			/>
		{/if}
	{/if}
</a>

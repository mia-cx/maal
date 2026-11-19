<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		level = 2,
		...restProps
	}: DialogPrimitive.TitleProps = $props();

	const titleClass = $derived(cn('font-heading text-sm font-medium', className));
</script>

<DialogPrimitive.Title bind:ref {level} data-slot="dialog-title" {...restProps}>
	{#snippet child({ props })}
		{#if level === 1}
			<h1 {...props} class={titleClass}>{@render children?.()}</h1>
		{:else if level === 3}
			<h3 {...props} class={titleClass}>{@render children?.()}</h3>
		{:else if level === 4}
			<h4 {...props} class={titleClass}>{@render children?.()}</h4>
		{:else if level === 5}
			<h5 {...props} class={titleClass}>{@render children?.()}</h5>
		{:else if level === 6}
			<h6 {...props} class={titleClass}>{@render children?.()}</h6>
		{:else}
			<h2 {...props} class={titleClass}>{@render children?.()}</h2>
		{/if}
	{/snippet}
</DialogPrimitive.Title>

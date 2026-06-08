<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: 'default' | 'sm' } = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	class={cn(
		'group/card flex flex-col gap-8 overflow-hidden bg-card py-8 text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 has-[>img:first-child]:pt-0 data-[size=sm]:gap-5 data-[size=sm]:py-5 *:[img:first-child]:rounded-none *:[img:last-child]:rounded-none',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>

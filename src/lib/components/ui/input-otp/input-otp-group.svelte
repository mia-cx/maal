<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="input-otp-group"
	class={cn(
		'flex items-center gap-1 rounded-none has-aria-invalid:border-b-destructive dark:has-aria-invalid:border-b-destructive/50',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>

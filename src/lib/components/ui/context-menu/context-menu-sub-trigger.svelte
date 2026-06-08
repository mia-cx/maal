<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';
	import { CaretRightIcon } from '$lib/components/icons/solar-outline';

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: WithoutChild<ContextMenuPrimitive.SubTriggerProps> & {
		inset?: boolean;
	} = $props();
</script>

<ContextMenuPrimitive.SubTrigger
	bind:ref
	data-slot="context-menu-sub-trigger"
	data-inset={inset}
	class={cn(
		"flex cursor-default items-center rounded-none px-3 py-2 text-xs font-medium tracking-wider uppercase outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:ps-8 data-inset:pl-9.5 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<CaretRightIcon class="ml-auto" />
</ContextMenuPrimitive.SubTrigger>

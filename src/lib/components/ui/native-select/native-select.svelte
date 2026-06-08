<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { CaretDownIcon } from '$lib/components/icons/solar-outline';

	type NativeSelectProps = Omit<HTMLSelectAttributes, 'size'> & {
		ref?: HTMLSelectElement | null;
		size?: 'sm' | 'default';
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = 'default',
		children,
		...restProps
	}: NativeSelectProps = $props();
</script>

<div
	class={cn(
		'cn-native-select-wrapper group/native-select relative w-fit has-[select:disabled]:opacity-50',
		className
	)}
	data-slot="native-select-wrapper"
	data-size={size}
>
	<select
		bind:value
		bind:this={ref}
		data-slot="native-select"
		data-size={size}
		class="h-10 w-full min-w-0 appearance-none rounded-none border border-transparent border-b-input bg-transparent py-2 pr-8 pl-0 text-sm transition-[color,border-color] outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-b-ring disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-b-destructive data-[size=sm]:h-9 dark:aria-invalid:border-b-destructive/50"
		{...restProps}
	>
		{@render children?.()}
	</select>
	<CaretDownIcon
		class="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-muted-foreground select-none"
		aria-hidden
		data-slot="native-select-icon"
	/>
</div>

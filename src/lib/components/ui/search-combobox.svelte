<script lang="ts" module>
	export type SearchComboboxOption = {
		value: string;
		label?: string;
		keywords?: string[];
	};
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Command from '$lib/components/ui/command';
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils.js';

	let {
		value = $bindable(''),
		name,
		options,
		disabled = false,
		placeholder = 'Select option',
		searchPlaceholder = 'Search...',
		emptyText = 'No results found.',
		allowCustom = false,
		customOptionLabel = (input: string) => `Use “${input}”`,
		class: className
	}: {
		value: string;
		name?: string;
		options: readonly SearchComboboxOption[];
		disabled?: boolean;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		allowCustom?: boolean;
		customOptionLabel?: (input: string) => string;
		class?: string;
	} = $props();

	let open = $state(false);
	let search = $state('');

	const selectedOption = $derived(options.find((option) => option.value === value));
	const displayValue = $derived(selectedOption?.label ?? (value || placeholder));
	const customValue = $derived(search.trim());
	const showCustomOption = $derived(
		allowCustom &&
			customValue.length > 0 &&
			!options.some((option) => option.value.toLowerCase() === customValue.toLowerCase())
	);
</script>

{#if name}
	<input type="hidden" {name} {value} />
{/if}

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="outline"
				size="lg"
				{disabled}
				class={cn('h-8 w-full justify-between px-2 font-normal', className)}
			>
				<span class={cn('truncate', !value && 'text-muted-foreground')}>{displayValue}</span>
				<span aria-hidden="true" class="ml-2 text-muted-foreground">⌄</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-[var(--bits-popover-anchor-width)] p-0">
		<Command.Root {value} loop>
			<Command.Input bind:value={search} placeholder={searchPlaceholder} />
			<Command.List>
				<Command.Empty>{emptyText}</Command.Empty>
				{#if showCustomOption}
					<Command.Item
						value={customValue}
						forceMount
						onSelect={() => {
							value = customValue;
							search = '';
							open = false;
						}}
					>
						<span class="truncate">{customOptionLabel(customValue)}</span>
					</Command.Item>
				{/if}
				{#each options as option (option.value)}
					<Command.Item
						value={option.value}
						keywords={option.keywords}
						onSelect={() => {
							value = option.value;
							search = '';
							open = false;
						}}
					>
						<span class="truncate">{option.label ?? option.value}</span>
					</Command.Item>
				{/each}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>

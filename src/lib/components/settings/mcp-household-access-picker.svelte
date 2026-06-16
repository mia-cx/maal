<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Command from '$lib/components/ui/command';
	import * as Popover from '$lib/components/ui/popover';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import type { SettingsHousehold } from '$lib/settings/types';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';

	let {
		mcpKeyHouseholdKind = $bindable<'all' | 'households'>('households'),
		mcpHouseholdPickerOpen = $bindable(false),
		mcpHouseholdQuery = $bindable(''),
		mcpHouseholdPickerLabel,
		filteredMcpHouseholds,
		mcpKeyHouseholdIds,
		toggleMcpHousehold
	}: {
		mcpKeyHouseholdKind: 'all' | 'households';
		mcpHouseholdPickerOpen: boolean;
		mcpHouseholdQuery: string;
		mcpHouseholdPickerLabel: string;
		filteredMcpHouseholds: SettingsHousehold[];
		mcpKeyHouseholdIds: string[];
		toggleMcpHousehold: (householdId: string, checked: boolean) => void;
	} = $props();
</script>

<div class="grid gap-2 text-xs">
	<span class="font-medium">Households</span>
	<RadioGroup.Root bind:value={mcpKeyHouseholdKind} class="gap-2">
		<label class="flex items-center gap-2 py-1">
			<RadioGroup.Item value="all" />
			<span>All current and future households</span>
		</label>
		<label class="flex items-center gap-2 py-1">
			<RadioGroup.Item value="households" />
			<span>Selected households</span>
		</label>
	</RadioGroup.Root>
	{#if mcpKeyHouseholdKind === 'households'}
		<Popover.Root bind:open={mcpHouseholdPickerOpen}>
			<Popover.Trigger>
				<Button
					type="button"
					variant="outline"
					class="h-8 w-full justify-between text-xs font-normal"
				>
					<span class="truncate">{mcpHouseholdPickerLabel}</span>
					<ChevronsUpDownIcon class="size-3.5 opacity-50" />
				</Button>
			</Popover.Trigger>
			<Popover.Content align="start" class="w-[22rem] max-w-[calc(100vw-2rem)] p-1">
				<Command.Root shouldFilter={false}>
					<Command.Input bind:value={mcpHouseholdQuery} placeholder="Search households…" />
					<Command.List class="max-h-56 overflow-y-auto p-1">
						{#if filteredMcpHouseholds.length === 0}
							<Command.Empty>No households found.</Command.Empty>
						{:else}
							{#each filteredMcpHouseholds as household (household.id)}
								{@const checked = mcpKeyHouseholdIds.includes(household.id)}
								<Command.Item
									value={household.id}
									data-checked={checked}
									onSelect={() => toggleMcpHousehold(household.id, !checked)}
								>
									<Checkbox {checked} class="pointer-events-none" />
									<span class="truncate">{household.name}</span>
								</Command.Item>
							{/each}
						{/if}
					</Command.List>
				</Command.Root>
			</Popover.Content>
		</Popover.Root>
	{/if}
</div>

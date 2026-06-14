<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { HomeIcon } from '$lib/components/icons/solar-outline';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import { setActiveHouseholdId } from '$lib/stores/active-household';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';

	type Household = { id: string; name: string };

	let {
		households = [],
		activeHouseholdId = null,
		label = 'Households'
	}: { households?: Household[]; activeHouseholdId?: string | null; label?: string } = $props();
	const sidebar = useSidebar();

	const activeHousehold = $derived(
		households.find((household) => household.id === activeHouseholdId) ?? households[0] ?? null
	);
	const householdName = $derived(activeHousehold?.name ?? 'No household');
	const householdMeta = $derived(activeHousehold ? 'Household' : 'Create one from Meal Plan');
	const startHouseholdCreation = () => goto(resolve('/onboarding?new=1'));
	const switchHousehold = async (householdId: string) => {
		if (householdId === activeHouseholdId) return;
		const previousHouseholdId = activeHouseholdId;
		setActiveHouseholdId(householdId);

		const response = await fetch(resolve('/api/active-household'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ householdId })
		});
		if (!response.ok) {
			setActiveHouseholdId(previousHouseholdId);
			return;
		}
		await invalidateAll();
	};
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						class="h-9 gap-2 p-0 pr-3 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<span
							class="flex size-9 shrink-0 items-center justify-center bg-[var(--brand-salmon)] text-white"
						>
							<HomeIcon class="size-4" />
						</span>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{householdName}</span>
							<span class="truncate text-xs">{householdMeta}</span>
						</div>
						<ChevronsUpDownIcon class="ms-auto" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				align="start"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				sideOffset={4}
			>
				<DropdownMenu.Label class="text-xs text-muted-foreground">{label}</DropdownMenu.Label>
				{#if households.length > 0}
					{#each households as household (household.id)}
						<DropdownMenu.Item
							class="gap-2 p-2"
							disabled={household.id === activeHouseholdId}
							onclick={() => switchHousehold(household.id)}
						>
							<HomeIcon class="size-5 shrink-0 text-primary" />
							<span class="truncate">{household.name}</span>
						</DropdownMenu.Item>
					{/each}
				{:else}
					<DropdownMenu.Item disabled class="gap-2 p-2 text-muted-foreground">
						<HomeIcon class="size-5 shrink-0" />
						No household yet
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator />
				<DropdownMenu.Item class="gap-2 p-2" onclick={startHouseholdCreation}>
					<PlusIcon class="size-5 shrink-0" />
					<span class="truncate">New household</span>
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

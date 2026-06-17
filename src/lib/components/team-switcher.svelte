<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { HomeIcon } from '$lib/components/icons/solar-outline';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import {
		activeHouseholdId as activeHouseholdIdStore,
		setActiveHouseholdId,
		writeActiveHouseholdCookie
	} from '$lib/stores/active-household';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { onDestroy, onMount } from 'svelte';

	type Household = { id: string; name: string };

	let {
		households = [],
		activeHouseholdId = null,
		label = 'Households'
	}: { households?: Household[]; activeHouseholdId?: string | null; label?: string } = $props();
	const sidebar = useSidebar();
	let clientActiveHouseholdId = $state<string | null>(null);
	let lastServerActiveHouseholdId = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let switchRequestId = 0;

	const activeHousehold = $derived(
		households.find((household) => household.id === clientActiveHouseholdId) ??
			households[0] ??
			null
	);
	const householdName = $derived(activeHousehold?.name ?? 'No household');
	const householdMeta = $derived(activeHousehold ? 'Household' : 'Create one from Meal Plan');
	const isKnownHouseholdId = (householdId: string | null): householdId is string =>
		Boolean(householdId && households.some((household) => household.id === householdId));
	const startHouseholdCreation = () => goto(resolve('/onboarding?new=1'));
	const switchHousehold = async (householdId: string) => {
		if (householdId === clientActiveHouseholdId) return;
		const requestId = ++switchRequestId;
		const previousHouseholdId = clientActiveHouseholdId;
		switchError = null;
		clientActiveHouseholdId = householdId;
		setActiveHouseholdId(householdId);
		writeActiveHouseholdCookie(householdId);

		try {
			await invalidateAll();
		} catch (cause) {
			if (requestId !== switchRequestId) return;
			console.error('Failed to switch household', cause);
			clientActiveHouseholdId = previousHouseholdId;
			setActiveHouseholdId(previousHouseholdId);
			writeActiveHouseholdCookie(previousHouseholdId);
			switchError = 'Could not switch households. Please try again.';
		}
	};

	$effect(() => {
		if (activeHouseholdId !== lastServerActiveHouseholdId) {
			lastServerActiveHouseholdId = activeHouseholdId;
			clientActiveHouseholdId = activeHouseholdId;
		}
	});

	let unsubscribeActiveHousehold: (() => void) | null = null;
	onMount(() => {
		unsubscribeActiveHousehold = activeHouseholdIdStore.subscribe((householdId) => {
			if (!isKnownHouseholdId(householdId)) return;
			clientActiveHouseholdId = householdId;
		});
	});
	onDestroy(() => unsubscribeActiveHousehold?.());
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
				{#if switchError}
					<p class="px-2 py-1 text-xs text-destructive">{switchError}</p>
				{/if}
				{#if households.length > 0}
					{#each households as household (household.id)}
						<DropdownMenu.Item
							class="gap-2 p-2"
							disabled={household.id === clientActiveHouseholdId}
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

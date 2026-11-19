<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';

	import type { MaalDatabase } from '$lib/client/local/database.js';
	import {
		activeHouseholdKey,
		listHouseholdsForProfile,
		setActiveHousehold,
		type ProfileHouseholdView
	} from '$lib/client/local/index.js';
	import { HomeIcon } from '$lib/components/icons/solar-outline';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';

	let { database, label = 'Households' }: { database: MaalDatabase; label?: string } = $props();
	const sidebar = useSidebar();
	let households = $state<readonly ProfileHouseholdView[]>([]);
	let activeProfileId = $state<string | null>(null);
	let activeHouseholdId = $state<string | null>(null);
	let switchError = $state<string | null>(null);

	const activeView = $derived(
		households.find(({ household }) => household.householdId === activeHouseholdId) ??
			households[0] ??
			null
	);
	const householdName = $derived(activeView?.household.name ?? 'No household');
	const householdMeta = $derived(
		activeView?.detached
			? 'Detached local snapshot'
			: activeView
				? 'Household'
				: 'Create a household'
	);

	onMount(() => {
		const subscription = liveQuery(async () => {
			const activeProfile = await database.uiState.get('activeProfileId');
			const profileId = typeof activeProfile?.value === 'string' ? activeProfile.value : null;
			if (!profileId) return { profileId: null, activeHouseholdId: null, households: [] };
			const activeHousehold = await database.uiState.get(activeHouseholdKey(profileId));
			return {
				profileId,
				activeHouseholdId:
					typeof activeHousehold?.value === 'string' ? activeHousehold.value : null,
				households: await listHouseholdsForProfile(database, profileId)
			};
		}).subscribe((value) => {
			activeProfileId = value.profileId;
			activeHouseholdId = value.activeHouseholdId;
			households = value.households;
		});
		return () => subscription.unsubscribe();
	});

	const switchHousehold = async (householdId: string) => {
		if (!activeProfileId || householdId === activeHouseholdId) return;
		switchError = null;
		try {
			await setActiveHousehold(database, activeProfileId, householdId);
		} catch {
			switchError = 'Could not switch households.';
		}
	};
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						class="h-9 gap-2 p-0 pe-3 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
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
				{#if switchError}<p class="px-2 py-1 text-xs text-destructive">{switchError}</p>{/if}
				{#if households.length > 0}
					{#each households as view (view.household.householdId)}
						<DropdownMenu.Item
							class="gap-2 p-2"
							disabled={view.household.householdId === activeHouseholdId}
							onclick={() => void switchHousehold(view.household.householdId)}
						>
							<HomeIcon class="size-5 shrink-0 text-primary" />
							<div class="grid min-w-0 flex-1">
								<span class="truncate">{view.household.name}</span>
								{#if view.detached}<span class="text-xs text-muted-foreground"
										>Detached snapshot</span
									>{/if}
							</div>
						</DropdownMenu.Item>
					{/each}
				{:else}
					<DropdownMenu.Item disabled class="gap-2 p-2 text-muted-foreground">
						<HomeIcon class="size-5 shrink-0" /> No household yet
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator />
				<DropdownMenu.Item class="gap-2 p-2" onclick={() => goto(resolve('/household?create=1'))}>
					<PlusIcon class="size-5 shrink-0" />
					<span class="truncate">New household</span>
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

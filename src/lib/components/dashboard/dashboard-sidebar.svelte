<script lang="ts">
	import { resolve } from '$app/paths';
	import NavUser from '$lib/components/nav-user.svelte';
	import TeamSwitcher from '$lib/components/team-switcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import HomeIcon from '@lucide/svelte/icons/house';
	import ListIcon from '@lucide/svelte/icons/list';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import SoupIcon from '@lucide/svelte/icons/soup';
	import type { FeaturePreviews } from '$lib/features/flags';
	import type { DashboardNavItem } from './dashboard-nav';

	type SidebarUser = { name: string; email: string; avatar: string; emailVerified: boolean };
	type Household = { id: string; name: string };

	const disabledFeatures: FeaturePreviews = { pantry: false, groceryRollup: false };

	let {
		user,
		activeNav = 'meal-plan',
		households = [],
		activeHouseholdId = null,
		features = disabledFeatures
	}: {
		user: SidebarUser;
		activeNav?: DashboardNavItem;
		households?: Household[];
		activeHouseholdId?: string | null;
		features?: FeaturePreviews;
	} = $props();

	const planHref = resolve('/plan');
	const menuHref = resolve('/menu');
	const pantryHref = resolve('/pantry');
	const groceryRollupHref = resolve('/groceries');
	const householdHref = resolve('/household');
</script>

<Sidebar.Root collapsible="icon" data-testid="app-sidebar">
	<Sidebar.Header>
		<TeamSwitcher {households} {activeHouseholdId} label="Households" />
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel class="h-10 px-2 text-sidebar-foreground">
				<WordmarkLogo class="h-5 w-16" />
			</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'meal-plan'}
							tooltipContent="Meal Plan"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
						>
							{#snippet child({ props })}
								<a href={planHref} {...props}>
									<CalendarDaysIcon />
									<span>Meal Plan</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'my-menu'}
							tooltipContent="My Menu"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
						>
							{#snippet child({ props })}
								<a href={menuHref} {...props}>
									<ListIcon />
									<span>My Menu</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'pantry'}
							disabled={!features.pantry}
							tooltipContent={features.pantry ? 'Pantry' : 'Pantry preview unavailable'}
							class={`h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2! ${features.pantry ? '' : 'text-muted-foreground'}`}
						>
							{#if features.pantry}
								{#snippet child({ props })}
									<a href={pantryHref} {...props}>
										<SoupIcon />
										<span>Pantry</span>
									</a>
								{/snippet}
							{:else}
								<SoupIcon />
								<span>Pantry</span>
							{/if}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'grocery-rollup'}
							disabled={!features.groceryRollup}
							tooltipContent={features.groceryRollup
								? 'Grocery rollup'
								: 'Grocery rollup preview unavailable'}
							class={`h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2! ${features.groceryRollup ? '' : 'text-muted-foreground'}`}
						>
							{#if features.groceryRollup}
								{#snippet child({ props })}
									<a href={groceryRollupHref} {...props}>
										<ShoppingCartIcon />
										<span>Grocery rollup</span>
									</a>
								{/snippet}
							{:else}
								<ShoppingCartIcon />
								<span>Grocery rollup</span>
							{/if}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'household'}
							tooltipContent="Household"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
						>
							{#snippet child({ props })}
								<a href={householdHref} {...props}>
									<HomeIcon />
									<span>Household</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		<NavUser {user} />
	</Sidebar.Footer>
</Sidebar.Root>

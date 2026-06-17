<script lang="ts">
	import * as m from '$lib/paraglide/messages';
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

<Sidebar.Root
	collapsible="icon"
	data-testid="app-sidebar"
	data-sveltekit-preload-code="eager"
	data-sveltekit-preload-data="hover"
>
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
									<span>{m.app_meal_plan()}</span>
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
									<span>{m.app_my_menu()}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'pantry'}
							aria-disabled={!features.pantry}
							tooltipContent={features.pantry ? 'Pantry' : 'Pantry preview unavailable'}
							class={`h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2! ${features.pantry ? '' : 'text-muted-foreground'}`}
						>
							{#snippet child({ props })}
								{#if features.pantry}
									<a href={pantryHref} {...props}>
										<SoupIcon />
										<span>{m.app_pantry()}</span>
									</a>
								{:else}
									<span {...props}>
										<SoupIcon />
										<span>{m.app_pantry()}</span>
									</span>
								{/if}
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'grocery-rollup'}
							aria-disabled={!features.groceryRollup}
							tooltipContent={features.groceryRollup
								? 'Grocery rollup'
								: 'Grocery rollup preview unavailable'}
							class={`h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2! ${features.groceryRollup ? '' : 'text-muted-foreground'}`}
						>
							{#snippet child({ props })}
								{#if features.groceryRollup}
									<a href={groceryRollupHref} {...props}>
										<ShoppingCartIcon />
										<span>{m.app_grocery_rollup()}</span>
									</a>
								{:else}
									<span {...props}>
										<ShoppingCartIcon />
										<span>{m.app_grocery_rollup()}</span>
									</span>
								{/if}
							{/snippet}
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
									<span>{m.app_household()}</span>
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

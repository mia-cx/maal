<script lang="ts">
	import { resolve } from '$app/paths';
	import NavUser from '$lib/components/nav-user.svelte';
	import TeamSwitcher from '$lib/components/team-switcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import HomeIcon from '@lucide/svelte/icons/house';
	import ListIcon from '@lucide/svelte/icons/list';
	import SoupIcon from '@lucide/svelte/icons/soup';
	import type { DashboardNavItem } from './dashboard-nav';

	type SidebarUser = { name: string; email: string; avatar: string; emailVerified: boolean };
	type Household = { id: string; name: string };

	let {
		user,
		activeNav = 'meal-plan',
		households = [],
		activeHouseholdId = null
	}: {
		user: SidebarUser;
		activeNav?: DashboardNavItem;
		households?: Household[];
		activeHouseholdId?: string | null;
	} = $props();

	const planHref = resolve('/plan');
	const menuHref = resolve('/menu');
	const householdHref = resolve('/household');
</script>

<Sidebar.Root collapsible="icon" data-testid="app-sidebar">
	<Sidebar.Header>
		<TeamSwitcher {households} {activeHouseholdId} label="Households" />
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Maal</Sidebar.GroupLabel>
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
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							disabled
							tooltipContent="Pantry staples coming soon"
							class="h-9 text-muted-foreground group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
						>
							<SoupIcon />
							<span>Pantry staples</span>
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

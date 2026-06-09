<script lang="ts">
	import { HomeIcon } from '$lib/components/icons/solar-outline';
	import NavUser from '$lib/components/nav-user.svelte';
	import TeamSwitcher from '$lib/components/team-switcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import GalleryVerticalEndIcon from '@lucide/svelte/icons/gallery-vertical-end';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import ListIcon from '@lucide/svelte/icons/list';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import SoupIcon from '@lucide/svelte/icons/soup';
	import type { DashboardNavItem } from './dashboard-nav';

	let {
		email,
		activeNav = $bindable<DashboardNavItem>('schedule')
	}: { email: string; activeNav?: DashboardNavItem } = $props();

	const teams = [
		{ name: 'Home', logo: HomeIcon, plan: 'Household' },
		{ name: 'Test kitchen', logo: GalleryVerticalEndIcon, plan: 'Preview' }
	];
	const user = $derived({
		name: email === 'Local preview' ? 'Local preview' : email.split('@')[0],
		email,
		avatar: ''
	});
</script>

<Sidebar.Root collapsible="icon" data-testid="app-sidebar">
	<Sidebar.Header>
		<TeamSwitcher {teams} label="Households" />
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Maal</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'schedule'}
							tooltipContent="Schedule"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
							onclick={() => (activeNav = 'schedule')}
						>
							<CalendarDaysIcon />
							<span>Schedule</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'my-menu'}
							tooltipContent="My menu"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
							onclick={() => (activeNav = 'my-menu')}
						>
							<ListIcon />
							<span>My menu</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'pantry-staples'}
							tooltipContent="Pantry staples"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
							onclick={() => (activeNav = 'pantry-staples')}
						>
							<SoupIcon />
							<span>Pantry staples</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeNav === 'preferences'}
							tooltipContent="Preferences"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
							onclick={() => (activeNav = 'preferences')}
						>
							<HeartIcon />
							<span>Preferences</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							disabled
							tooltipContent="Settings"
							class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
						>
							<Settings2Icon />
							<span>Settings</span>
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

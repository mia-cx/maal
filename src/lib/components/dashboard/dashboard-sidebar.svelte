<script lang="ts">
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';

	import type { MaalDatabase } from '$lib/client/local/database.js';
	import ProfileSwitcher from '$lib/components/profile-switcher.svelte';
	import TeamSwitcher from '$lib/components/team-switcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import type { DashboardNavItem } from './dashboard-nav.js';

	let {
		database,
		activeNav = 'meal-plan'
	}: { database: MaalDatabase; activeNav?: DashboardNavItem } = $props();

	const links = [
		{ href: '/plan', label: 'Meal plan', nav: 'meal-plan', icon: CalendarDaysIcon },
		{ href: '/menu', label: 'Recipes', nav: 'my-menu', icon: UtensilsIcon },
		{ href: '/household', label: 'Household', nav: 'household', icon: SettingsIcon }
	] as const;
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<Sidebar.Root collapsible="icon" data-testid="app-sidebar">
	<Sidebar.Header><TeamSwitcher {database} /></Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel class="h-10 px-2 text-sidebar-foreground">
				<WordmarkLogo class="h-5 w-16" />
			</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each links as link (link.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={activeNav === link.nav} tooltipContent={link.label}>
								{#snippet child({ props })}
									<a href={link.href} {...props}><link.icon /><span>{link.label}</span></a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer><ProfileSwitcher {database} /></Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

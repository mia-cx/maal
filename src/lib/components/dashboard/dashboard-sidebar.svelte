<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import HomeIcon from '@lucide/svelte/icons/house';
	import ListIcon from '@lucide/svelte/icons/list';

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
		{ href: '/plan', label: m.app_meal_plan, nav: 'meal-plan', icon: CalendarDaysIcon },
		{ href: '/menu', label: m.app_my_menu, nav: 'my-menu', icon: ListIcon },
		{ href: '/household', label: m.app_household, nav: 'household', icon: HomeIcon }
	] as const;
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<Sidebar.Root
	collapsible="icon"
	data-testid="app-sidebar"
	data-sveltekit-preload-code="eager"
	data-sveltekit-preload-data="hover"
>
	<Sidebar.Header><TeamSwitcher {database} label={m.settings_households()} /></Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel class="h-10 px-2 text-sidebar-foreground">
				<WordmarkLogo class="h-5 w-16" />
			</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each links as link (link.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={activeNav === link.nav}
								tooltipContent={link.label()}
								class="h-9 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!"
							>
								{#snippet child({ props })}
									<a href={link.href} {...props}><link.icon /><span>{link.label()}</span></a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer><ProfileSwitcher {database} /></Sidebar.Footer>
</Sidebar.Root>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

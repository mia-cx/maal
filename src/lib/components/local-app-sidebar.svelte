<script lang="ts">
	import { page } from '$app/state';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';

	import type { MaalDatabase } from '$lib/client/local/database.js';
	import ProfileSwitcher from '$lib/components/profile-switcher.svelte';
	import TeamSwitcher from '$lib/components/team-switcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';

	let { database }: { database: MaalDatabase } = $props();
	const links = [
		{ href: '/plan', label: 'Meal plan', icon: CalendarDaysIcon },
		{ href: '/menu', label: 'Recipes', icon: UtensilsIcon },
		{ href: '/household', label: 'Household', icon: SettingsIcon }
	];
</script>

<!-- Prototype destinations are restored by their owning feature slices. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<TeamSwitcher {database} />
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each links as link (link.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={page.url.pathname === link.href}>
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
	<Sidebar.Footer>
		<ProfileSwitcher {database} />
		<div class="hidden px-2 pb-1 group-data-[collapsible=icon]:hidden md:block">
			<WordmarkLogo class="h-5 w-auto text-muted-foreground" />
		</div>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

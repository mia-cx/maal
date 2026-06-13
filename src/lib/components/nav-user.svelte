<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import UserSettingsDialog from '$lib/components/user-settings-dialog.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';

	type NavUser = { name: string; email: string; avatar: string; emailVerified: boolean };

	let { user }: { user: NavUser } = $props();
	const sidebar = useSidebar();

	let localUser = $derived(user);
	let settingsOpen = $state(false);

	const initials = $derived(localUser.name.slice(0, 2).toUpperCase());
	const homeHref = resolve('/' as Pathname);
	const logoutHref = resolve('/auth/logout' as Pathname);

	const updateLocalUser = (updatedUser: {
		name: string | null;
		email: string;
		emailVerified: boolean;
	}) => {
		localUser = {
			...localUser,
			name: updatedUser.name ?? updatedUser.email,
			email: updatedUser.email,
			emailVerified: updatedUser.emailVerified
		};
	};
</script>

<UserSettingsDialog bind:open={settingsOpen} user={localUser} onuserupdate={updateLocalUser} />

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						class="h-9 gap-2 p-0 pr-3 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						{...props}
					>
						<Avatar.Root
							class="size-9 rounded-[calc(var(--radius-sm)+2px)] after:rounded-[calc(var(--radius-sm)+2px)]"
						>
							<Avatar.Image src={localUser.avatar} alt={localUser.name} />
							<Avatar.Fallback class="rounded-[calc(var(--radius-sm)+2px)]"
								>{initials}</Avatar.Fallback
							>
						</Avatar.Root>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{localUser.name}</span>
							<span class="truncate text-xs">{localUser.email}</span>
						</div>
						<ChevronsUpDownIcon class="ms-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="end"
				sideOffset={4}
			>
				<DropdownMenu.Label class="p-0 font-normal">
					<div class="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
						<Avatar.Root class="size-8 rounded-lg after:rounded-lg">
							<Avatar.Image src={localUser.avatar} alt={localUser.name} />
							<Avatar.Fallback class="rounded-lg">{initials}</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{localUser.name}</span>
							<span class="truncate text-xs">{localUser.email}</span>
						</div>
					</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Item onclick={() => (settingsOpen = true)} class="cursor-pointer">
						<Settings2Icon />
						User settings
					</DropdownMenu.Item>
					<DropdownMenu.Item>
						{#if homeHref}
							<a href={homeHref} class="flex w-full items-center gap-2">
								<ArrowLeftIcon />
								Back to home
							</a>
						{:else}
							<ArrowLeftIcon />
							Back to home
						{/if}
					</DropdownMenu.Item>
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Item>
					{#if logoutHref}
						<a href={logoutHref} class="flex w-full items-center gap-2">
							<LogOutIcon />
							Log out
						</a>
					{:else}
						<LogOutIcon />
						Log out
					{/if}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

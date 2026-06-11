<script lang="ts">
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { keyboardShortcut } from '$lib/actions/keyboard-shortcut';
	import DashboardSidebar from '$lib/components/dashboard/dashboard-sidebar.svelte';
	import type { DashboardNavItem } from '$lib/components/dashboard/dashboard-nav';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { uiState, updateUiState } from '$lib/stores/ui-state';
	import { ModeWatcher } from 'mode-watcher';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	const minSidebarWidth = 208;
	const maxSidebarWidth = 384;

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const initialUiState = uiState.get();

	let sidebarOpen = $state(initialUiState.sidebarOpen);
	let sidebarWidth = $state(initialUiState.sidebarWidth);
	let resizingSidebar = $state(false);

	const sidebarUser = $derived({
		name: data.session?.user.name ?? data.session?.user.email?.split('@')[0] ?? 'Local preview',
		email: data.session?.user.email ?? 'Local preview',
		avatar: data.session?.user.profilePictureUrl ?? '',
		emailVerified: data.session?.user.emailVerified ?? false
	});
	const showDashboardShell = $derived(
		!page.url.pathname.includes('/auth') && !page.url.pathname.startsWith('/onboarding')
	);
	const activeNav = $derived<DashboardNavItem>(
		page.url.pathname.startsWith('/menu')
			? 'my-menu'
			: page.url.pathname.startsWith('/household')
				? 'household'
				: 'meal-plan'
	);

	const startSidebarResize = (event: PointerEvent) => {
		resizingSidebar = true;
		event.preventDefault();
	};

	const resizeSidebar = (event: PointerEvent) => {
		if (!resizingSidebar) return;
		sidebarWidth = Math.min(maxSidebarWidth, Math.max(minSidebarWidth, event.clientX));
	};

	const stopSidebarResize = () => {
		resizingSidebar = false;
	};

	const toggleSidebar = () => {
		if (!showDashboardShell) return;
		sidebarOpen = !sidebarOpen;
	};

	$effect(() => {
		updateUiState({ activeNav, sidebarOpen, sidebarWidth });
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<svelte:window onpointermove={resizeSidebar} onpointerup={stopSidebarResize} />
<ModeWatcher />

<div
	class="contents"
	use:keyboardShortcut={{
		target: 'window',
		bindings: [
			{
				id: 'sidebar.toggle',
				combo: { key: 's', meta: false, ctrl: false, alt: false },
				when: () => showDashboardShell,
				handler: toggleSidebar
			}
		]
	}}
>
	{#if showDashboardShell}
		<Sidebar.Provider
			bind:open={sidebarOpen}
			class={resizingSidebar ? 'sidebar-resizing' : undefined}
			style="--sidebar-width: {sidebarWidth}px;"
		>
			<DashboardSidebar
				user={sidebarUser}
				{activeNav}
				households={data.households}
				activeHouseholdId={data.activeHouseholdId}
			/>
			{#if sidebarOpen}
				<button
					aria-label="Resize sidebar"
					class="fixed top-0 bottom-0 z-[55] w-3 cursor-col-resize bg-transparent after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:bg-border"
					style:left="{sidebarWidth - 6}px"
					onpointerdown={startSidebarResize}
				></button>
			{/if}
			<Sidebar.Inset>
				<main data-dashboard-main class="@container/dashboard-main min-h-svh min-w-0">
					{@render children()}
				</main>
			</Sidebar.Inset>
		</Sidebar.Provider>
	{:else}
		{@render children()}
	{/if}

	<div style="display:none">
		{#each locales as locale (locale)}
			<a href={resolve(localizeHref(page.url.pathname, { locale }) as Pathname)}>{locale}</a>
		{/each}
	</div>
</div>

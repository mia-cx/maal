<script lang="ts">
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import DashboardSidebar from '$lib/components/dashboard/dashboard-sidebar.svelte';
	import type { DashboardNavItem } from '$lib/components/dashboard/dashboard-nav';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { ModeWatcher } from 'mode-watcher';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	const minSidebarWidth = 208;
	const maxSidebarWidth = 384;

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	let activeNav = $state<DashboardNavItem>('schedule');
	let sidebarOpen = $state(true);
	let sidebarWidth = $state(256);
	let resizingSidebar = $state(false);

	const sidebarEmail = $derived(data.session?.user.email ?? 'Local preview');
	const showDashboardShell = $derived(!page.url.pathname.includes('/auth'));

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
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<svelte:window onpointermove={resizeSidebar} onpointerup={stopSidebarResize} />
<ModeWatcher />

{#if showDashboardShell}
	<Sidebar.Provider
		bind:open={sidebarOpen}
		class={resizingSidebar ? 'sidebar-resizing' : undefined}
		style="--sidebar-width: {sidebarWidth}px;"
	>
		<DashboardSidebar email={sidebarEmail} bind:activeNav />
		{#if sidebarOpen}
			<button
				aria-label="Resize sidebar"
				class="fixed top-0 bottom-0 z-[55] w-3 cursor-col-resize bg-transparent after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:bg-border"
				style:left="{sidebarWidth - 6}px"
				onpointerdown={startSidebarResize}
			></button>
		{/if}
		<Sidebar.Inset>
			{@render children()}
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

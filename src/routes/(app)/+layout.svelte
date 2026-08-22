<script lang="ts">
	import { navigating, page } from '$app/state';
	import { onMount, type Snippet } from 'svelte';

	import { keyboardShortcut } from '$lib/actions/keyboard-shortcut.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { activeNavItemForPath } from '$lib/components/dashboard/active-nav.js';
	import DashboardSidebar from '$lib/components/dashboard/dashboard-sidebar.svelte';
	import LocalSettingsDialog from '$lib/components/local-settings-dialog.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	const minSidebarWidth = 208;
	const maxSidebarWidth = 384;
	const shellStateKey = 'appShell';

	let { children }: { children: Snippet } = $props();
	let database = $state<MaalDatabase | null>(null);
	let error = $state<string | null>(null);
	let sidebarOpen = $state(true);
	let sidebarWidth = $state(256);
	let resizingSidebar = $state(false);

	const activeNav = $derived(activeNavItemForPath(page.url.pathname));
	const navigatingWithinApp = $derived(Boolean(navigating.to?.url.pathname.startsWith('/')));
	const isSubscribePage = $derived(page.url.pathname.startsWith('/subscribe'));

	const persistShellState = async () => {
		if (!database) return;
		await database.uiState.put({
			key: shellStateKey,
			value: { sidebarOpen, sidebarWidth }
		});
	};

	const toggleSidebar = () => {
		sidebarOpen = !sidebarOpen;
		void persistShellState();
	};

	const startSidebarResize = (event: PointerEvent) => {
		resizingSidebar = true;
		event.currentTarget instanceof HTMLElement &&
			event.currentTarget.setPointerCapture(event.pointerId);
		event.preventDefault();
	};

	const resizeSidebar = (event: PointerEvent) => {
		if (!resizingSidebar) return;
		sidebarWidth = Math.min(maxSidebarWidth, Math.max(minSidebarWidth, event.clientX));
	};

	const stopSidebarResize = () => {
		if (!resizingSidebar) return;
		resizingSidebar = false;
		void persistShellState();
	};

	onMount(() => {
		void getBrowserDatabase()
			.then(async (opened) => {
				database = opened;
				const stored = await opened.uiState.get(shellStateKey);
				if (typeof stored?.value !== 'object' || stored.value === null) return;
				if ('sidebarOpen' in stored.value && typeof stored.value.sidebarOpen === 'boolean') {
					sidebarOpen = stored.value.sidebarOpen;
				}
				if ('sidebarWidth' in stored.value && typeof stored.value.sidebarWidth === 'number') {
					sidebarWidth = Math.min(
						maxSidebarWidth,
						Math.max(minSidebarWidth, stored.value.sidebarWidth)
					);
				}
			})
			.catch(() => {
				error = 'Local data could not be opened. Recovery may be required.';
			});
	});
</script>

<svelte:window onpointermove={resizeSidebar} onpointerup={stopSidebarResize} />

<div
	class="contents"
	use:keyboardShortcut={{
		target: 'window',
		bindings: [
			{
				id: 'sidebar.toggle',
				combo: { key: 's', meta: false, ctrl: false, alt: false },
				handler: toggleSidebar
			}
		]
	}}
>
	{#if database}
		<Sidebar.Provider
			bind:open={sidebarOpen}
			class={resizingSidebar ? 'sidebar-resizing' : undefined}
			style="--sidebar-width: {sidebarWidth}px;"
			data-testid="shared-app-shell"
		>
			<LocalSettingsDialog {database} />
			<DashboardSidebar {database} {activeNav} />
			{#if sidebarOpen}
				<button
					type="button"
					aria-label="Resize sidebar"
					class="fixed top-0 bottom-0 z-[55] hidden w-3 cursor-col-resize bg-transparent after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:bg-border md:block"
					style:left="{sidebarWidth - 6}px"
					onpointerdown={startSidebarResize}
				></button>
			{/if}
			<Sidebar.Inset class="min-w-0 overflow-hidden bg-background text-foreground">
				{#if navigatingWithinApp}
					<div class="fixed top-0 right-0 left-0 z-[70] h-0.5 overflow-hidden bg-transparent">
						<div
							class="h-full w-1/2 animate-pulse rounded-full bg-[var(--brand-salmon)]/80 shadow-[0_0_18px_rgb(254_113_86_/_0.55)]"
						></div>
					</div>
				{/if}
				<main
					data-dashboard-main
					aria-busy={navigatingWithinApp}
					class="@container/dashboard-main min-h-svh min-w-0 transition-opacity"
					class:h-svh={isSubscribePage}
					class:overflow-y-auto={isSubscribePage}
				>
					{@render children()}
				</main>
			</Sidebar.Inset>
		</Sidebar.Provider>
	{:else}
		<div class="grid min-h-svh place-items-center bg-background px-6 text-center text-foreground">
			<div class="grid gap-2 text-sm text-muted-foreground">
				<p>{error ?? 'Opening local Maal data…'}</p>
				{#if error}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="text-primary underline underline-offset-4" href="/recovery"
						>Open local recovery</a
					>
				{/if}
			</div>
		</div>
	{/if}
</div>

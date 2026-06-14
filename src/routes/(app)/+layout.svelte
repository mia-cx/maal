<script lang="ts">
	import { page } from '$app/state';
	import { keyboardShortcut } from '$lib/actions/keyboard-shortcut';
	import DashboardSidebar from '$lib/components/dashboard/dashboard-sidebar.svelte';
	import type { DashboardNavItem } from '$lib/components/dashboard/dashboard-nav';
	import * as Popover from '$lib/components/ui/popover';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { featurePreviews } from '$lib/features/flags';
	import { hydrateTaxonomyPreferences } from '$lib/stores/taxonomy-preferences';
	import { uiState, updateUiState } from '$lib/stores/ui-state';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	const minSidebarWidth = 208;
	const maxSidebarWidth = 384;

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const initialUiState = uiState.get();
	let sidebarOpen = $state(initialUiState.sidebarOpen);
	let sidebarWidth = $state(initialUiState.sidebarWidth);
	let resizingSidebar = $state(false);
	let exportDataPopoverOpen = $state(false);

	const features = $derived(featurePreviews(data.session));
	const sidebarUser = $derived({
		name: data.session?.user.name ?? data.session?.user.email?.split('@')[0] ?? 'Local preview',
		email: data.session?.user.email ?? 'Local preview',
		avatar: data.session?.user.profilePictureUrl ?? '',
		emailVerified: data.session?.user.emailVerified ?? false
	});
	const showDashboardShell = $derived(Boolean(data.session));
	const activeNav = $derived<DashboardNavItem>(
		page.url.pathname.startsWith('/menu')
			? 'my-menu'
			: page.url.pathname.startsWith('/pantry')
				? 'pantry'
				: page.url.pathname.startsWith('/groceries')
					? 'grocery-rollup'
					: page.url.pathname.startsWith('/household')
						? 'household'
						: 'meal-plan'
	);
	const isSubscribePage = $derived(page.url.pathname.startsWith('/subscribe'));
	const subscriptionLocked = $derived(
		Boolean(data.subscriptionLock?.locked) &&
			!page.url.pathname.startsWith('/household') &&
			!isSubscribePage
	);
	const canManageSubscription = $derived(Boolean(data.subscriptionLock?.canManageSubscription));

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
		hydrateTaxonomyPreferences(data.taxonomyPreferences);
	});

	$effect(() => {
		updateUiState({ activeNav, sidebarOpen, sidebarWidth });
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
				{features}
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
				<div
					class="relative min-h-svh min-w-0"
					class:h-svh={isSubscribePage}
					class:overflow-hidden={isSubscribePage}
				>
					<main
						data-dashboard-main
						class="@container/dashboard-main min-h-svh min-w-0 transition-opacity"
						class:h-svh={isSubscribePage}
						class:overflow-y-scroll={isSubscribePage}
						class:pointer-events-none={subscriptionLocked}
						class:opacity-25={subscriptionLocked}
						aria-hidden={subscriptionLocked}
					>
						{@render children()}
					</main>
					{#if subscriptionLocked}
						<div
							class="absolute inset-0 z-50 grid place-items-center bg-background/45 p-6 backdrop-blur-[1px]"
						>
							<div
								class="max-w-md rounded-xl border border-border bg-background p-5 text-center shadow-lg"
							>
								<h2 class="text-base font-semibold">This household has no active subscription</h2>
								{#if canManageSubscription}
									<p class="mt-2 text-sm text-muted-foreground">
										Subscribe to resume access for this household.
									</p>
									<div class="mt-4 flex justify-center gap-2">
										<a
											class="inline-flex h-9 items-center justify-center rounded-md bg-[var(--brand-salmon)] px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-[var(--brand-salmon)]/90 focus-visible:ring-2 focus-visible:ring-[var(--brand-salmon)]/30 focus-visible:outline-none"
											href="/subscribe"
										>
											Subscribe
										</a>
										<Popover.Root bind:open={exportDataPopoverOpen}>
											<Popover.Trigger
												class="inline-flex h-9 cursor-default items-center justify-center rounded-md border border-border bg-muted px-4 text-sm font-medium text-muted-foreground opacity-60 shadow-xs focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
												aria-label="Export data unavailable"
												onclick={(event) => event.preventDefault()}
												onfocus={() => (exportDataPopoverOpen = true)}
												onblur={() => (exportDataPopoverOpen = false)}
												onmouseenter={() => (exportDataPopoverOpen = true)}
												onmouseleave={() => (exportDataPopoverOpen = false)}
											>
												Export data
											</Popover.Trigger>
											<Popover.Content
												side="top"
												sideOffset={8}
												class="w-72 border border-border text-sm"
												onmouseenter={() => (exportDataPopoverOpen = true)}
												onmouseleave={() => (exportDataPopoverOpen = false)}
											>
												Email data-governance@maal.mia.cx to request your data.
											</Popover.Content>
										</Popover.Root>
									</div>
								{:else}
									<p class="mt-2 text-sm text-muted-foreground">
										Tell the household manager to resume their subscription, or
										<a class="font-medium underline underline-offset-4" href="/export-data"
											>export your data</a
										>.
									</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</Sidebar.Inset>
		</Sidebar.Provider>
	{:else}
		{@render children()}
	{/if}
</div>

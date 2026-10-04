<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import { activeHouseholdKey } from '$lib/client/local/profiles.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import HouseholdOnboarding from '$lib/components/household/household-onboarding.svelte';
	import HouseholdSettings from '$lib/components/household/household-settings.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let database = $state<MaalDatabase | null>(null);
	let activeProfileId = $state<string | null>(null);
	let activeHouseholdId = $state<string | null>(null);
	let error = $state<string | null>(null);

	onMount(() => {
		let unsubscribe: (() => void) | null = null;
		void getBrowserDatabase()
			.then((local) => {
				database = local;
				const subscription = liveQuery(async () => {
					const profileState = await local.uiState.get('activeProfileId');
					const profileId = typeof profileState?.value === 'string' ? profileState.value : null;
					if (!profileId) return { profileId: null, householdId: null };
					const householdState = await local.uiState.get(activeHouseholdKey(profileId));
					if (typeof householdState?.value === 'string') {
						return { profileId, householdId: householdState.value };
					}
					const profile = await local.profiles.get(profileId);
					const firstMembership = profile
						? await local.memberships
								.where('workosUserId')
								.equals(profile.workosUserId)
								.filter(({ status }) => status !== 'revoked')
								.first()
						: null;
					return { profileId, householdId: firstMembership?.householdId ?? null };
				}).subscribe((value) => {
					activeProfileId = value.profileId;
					activeHouseholdId = value.householdId;
				});
				unsubscribe = () => subscription.unsubscribe();
			})
			.catch(() => {
				error = 'Local data could not be opened. Recovery may be required.';
			});
		return () => unsubscribe?.();
	});
</script>

<svelte:head><title>Household · Maal</title></svelte:head>

{#if database}
	<header
		class="sticky top-0 z-40 flex h-[52px] shrink-0 items-center border-b border-border bg-background px-2"
	>
		<div class="flex w-9 shrink-0 items-center justify-center"><Sidebar.Trigger /></div>
	</header>
	<div class="h-[calc(100svh-52px)] min-h-0 overflow-y-auto">
		{#if activeProfileId && activeHouseholdId}
			<HouseholdSettings {database} profileId={activeProfileId} householdId={activeHouseholdId} />
		{:else if activeProfileId}
			<HouseholdOnboarding {database} profileId={activeProfileId} />
		{:else}
			<div class="mx-auto grid min-h-[60svh] max-w-xl place-items-center px-6 text-center">
				<div class="grid gap-2">
					<h1 class="text-xl font-semibold tracking-tight">Add a profile</h1>
					<p class="text-sm text-muted-foreground">
						Use the profile menu to sign in a real user on this device.
					</p>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="grid min-h-svh place-items-center bg-background px-6 text-center text-foreground">
		<div class="grid gap-2 text-sm text-muted-foreground">
			<p>{error ?? 'Opening local Maal data…'}</p>
			{#if error}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="text-primary underline underline-offset-4" href="/recovery">Open local recovery</a
				>
			{/if}
		</div>
	</div>
{/if}

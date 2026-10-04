<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import { createAuthSlotId } from '$lib/auth-slots/contracts.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import { activeHouseholdKey } from '$lib/client/local/profiles.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import HouseholdOnboarding from '$lib/components/household/household-onboarding.svelte';
	import HouseholdSettings from '$lib/components/household/household-settings.svelte';
	import PortableDataDialog from '$lib/components/portable-data-dialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let database = $state<MaalDatabase | null>(null);
	let activeProfileId = $state<string | null>(null);
	let activeHouseholdId = $state<string | null>(null);
	let canOnboard = $state(false);
	let reauthSlotId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let exportOpen = $state(false);

	// `?create=1` (team switcher) and `?join=<code>` (shared invite link) open onboarding even when
	// the profile already has a household.
	const inviteCode = $derived(page.url.searchParams.get('join') ?? '');
	const onboarding = $derived(page.url.searchParams.has('create') || inviteCode !== '');
	const signInHref = $derived(
		`/api/auth-slots/${reauthSlotId ?? createAuthSlotId()}/authorize?purpose=${reauthSlotId ? 'reauthenticate' : 'add-profile'}&returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);

	onMount(() => {
		let unsubscribe: (() => void) | null = null;
		void getBrowserDatabase()
			.then((local) => {
				const subscription = liveQuery(async () => {
					const profileState = await local.uiState.get('activeProfileId');
					const profileId = typeof profileState?.value === 'string' ? profileState.value : null;
					if (!profileId) {
						return { profileId: null, householdId: null, canOnboard: false, reauthSlotId: null };
					}
					const profile = await local.profiles.get(profileId);
					const slot = await local.authSlots.where('profileId').equals(profileId).first();
					const authentication = {
						canOnboard:
							(profile?.authState === 'authenticated' || profile?.authState === 'stale') &&
							slot?.sessionState === 'authenticated',
						// Sign-out removes the server identity binding, so revoked slots need a fresh sign-in.
						reauthSlotId:
							profile && profile.authState !== 'signedOut' && slot?.sessionState !== 'revoked'
								? (slot?.authSlotId ?? null)
								: null
					};
					const householdState = await local.uiState.get(activeHouseholdKey(profileId));
					if (typeof householdState?.value === 'string') {
						return { profileId, householdId: householdState.value, ...authentication };
					}
					const firstMembership = profile
						? await local.memberships
								.where('workosUserId')
								.equals(profile.workosUserId)
								.filter(({ status }) => status !== 'revoked')
								.first()
						: null;
					return {
						profileId,
						householdId: firstMembership?.householdId ?? null,
						...authentication
					};
				}).subscribe((value) => {
					activeProfileId = value.profileId;
					activeHouseholdId = value.householdId;
					canOnboard = value.canOnboard;
					reauthSlotId = value.reauthSlotId;
					database = local;
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
		{#if !canOnboard && (onboarding || !activeHouseholdId) && (activeProfileId || inviteCode)}
			<div class="mx-auto grid min-h-[60svh] max-w-xl place-items-center px-6 text-center">
				<div class="grid justify-items-center gap-3">
					<h1 class="text-xl font-semibold tracking-tight">
						{inviteCode ? 'Sign in to join this household' : 'Sign in to set up your household'}
					</h1>
					{#if inviteCode}
						<p class="text-sm text-muted-foreground">
							After you sign in, the invite code is filled in for you.
						</p>
					{/if}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<Button href={signInHref}>Sign in</Button>
				</div>
			</div>
		{:else if activeProfileId && (onboarding || !activeHouseholdId)}
			{#key `${activeProfileId}:${inviteCode}`}
				<HouseholdOnboarding
					{database}
					profileId={activeProfileId}
					{inviteCode}
					oncomplete={() => goto(resolve('/household'))}
				/>
			{/key}
		{:else if activeProfileId && activeHouseholdId}
			<PortableDataDialog {database} profileId={activeProfileId} bind:open={exportOpen} />
			{#key `${activeProfileId}:${activeHouseholdId}`}
				<HouseholdSettings
					{database}
					profileId={activeProfileId}
					householdId={activeHouseholdId}
					onexport={() => {
						exportOpen = true;
					}}
				/>
			{/key}
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

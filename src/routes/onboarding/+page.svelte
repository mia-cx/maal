<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { listHouseholdsForProfile } from '$lib/client/local/households.js';
	import { readActiveProfile, readLockedActiveProfile } from '$lib/client/local/profiles.js';
	import HouseholdOnboarding from '$lib/components/household/household-onboarding.svelte';
	import { Button } from '$lib/components/ui/button';

	let onboarding = $state<{
		database: MaalDatabase;
		profileId: string;
		defaultHouseholdName: string;
		hasHouseholds: boolean;
	}>();
	let error = $state(false);
	let needsSignIn = $state(false);
	let busy = $state(false);

	onMount(() => {
		const creatingAdditionalHousehold = page.url.searchParams.get('new') === '1';
		const subscription = liveQuery(async () => {
			const database = await getBrowserDatabase();
			const profile = await readActiveProfile(database);
			if (!profile) return { destination: 'sign-in' } as const;
			if (await readLockedActiveProfile(database)) return { destination: 'plan' } as const;
			const households = await listHouseholdsForProfile(database, profile.profileId);
			if (households.length && !creatingAdditionalHousehold)
				return { destination: 'has-household' } as const;
			const slot = await database.authSlots.where('profileId').equals(profile.profileId).first();
			if (
				(profile.authState !== 'authenticated' && profile.authState !== 'stale') ||
				slot?.sessionState !== 'authenticated'
			)
				return { destination: 'plan' } as const;
			return {
				destination: 'onboarding',
				database,
				profileId: profile.profileId,
				hasHouseholds: households.length > 0,
				defaultHouseholdName: `${profile.displayName || profile.email?.split('@')[0] || ''}'s kitchen`
			} as const;
		}).subscribe({
			next: (state) => {
				if (state.destination === 'onboarding') onboarding = state;
				else if (state.destination === 'plan' || state.destination === 'has-household') {
					if (state.destination === 'plan' || !busy) {
						void goto(resolve('/plan'), { replaceState: true });
					}
				} else needsSignIn = true;
			},
			error: () => {
				error = true;
			}
		});
		return () => subscription.unsubscribe();
	});
</script>

<svelte:head><title>Set up household · Maal</title></svelte:head>

{#if onboarding}
	{#key onboarding.profileId}
		<HouseholdOnboarding
			database={onboarding.database}
			profileId={onboarding.profileId}
			defaultHouseholdName={onboarding.defaultHouseholdName}
			hasHouseholds={onboarding.hasHouseholds}
			standalone
			bind:busy
			oncomplete={(_, trialStarted) =>
				goto(
					resolve(
						trialStarted === undefined
							? '/plan'
							: trialStarted
								? '/plan?trial=started'
								: '/subscribe'
					)
				)}
		/>
	{/key}
{:else if error}
	<a href={resolve('/recovery')}>Open local recovery</a>
{:else if needsSignIn}
	<div class="grid min-h-svh place-items-center">
		<Button href={resolve('/auth/login?returnTo=/onboarding')}>Sign in</Button>
	</div>
{/if}

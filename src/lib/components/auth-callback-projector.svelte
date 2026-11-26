<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import { AuthSlotCapacityExceeded } from '$lib/auth-slots/contracts.js';
	import {
		projectAuthCallback,
		refreshActiveProfileSlot,
		takeAuthCallbackMarker
	} from '$lib/client/auth-slot-projection.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import { readActiveProfile, readLockedActiveProfile } from '$lib/client/local/profiles.js';

	let message = $state<string | null>(null);

	onMount(() => {
		const marker = takeAuthCallbackMarker(new URL(window.location.href), (url) =>
			window.history.replaceState(window.history.state, '', url)
		);
		const options = {
			locale: navigator.language,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null
		};
		const database = getBrowserDatabase();

		const callback = marker
			? database
					.then((db) => projectAuthCallback(db, marker, options))
					.then((outcome) => {
						if (outcome.state === 'reauthRequired') {
							message = 'This profile needs to sign in again. Your local data is still available.';
						} else if (outcome.state === 'stale') {
							message = 'Maal could not verify this profile. Your local data is still available.';
						}
					})
					.catch((cause) => {
						message =
							cause instanceof AuthSlotCapacityExceeded
								? 'Eight profiles are already signed in on this device. Sign out of one, then add this profile again.'
								: 'Maal could not finish this sign-in. Your local data is still available.';
					})
			: Promise.resolve();

		// Each time a profile opens (launch, switch or PIN), re-read its slot in the background so
		// household, role and plan changes made elsewhere reach this device. Offline is a no-op.
		let opened: string | null = null;
		let subscription: { unsubscribe(): void } | undefined;
		let destroyed = false;
		void database.then((db) => {
			if (destroyed) return;
			subscription = liveQuery(async () =>
				(await readLockedActiveProfile(db))
					? null
					: ((await readActiveProfile(db))?.profileId ?? null)
			).subscribe((profileId) => {
				if (profileId === opened) return;
				opened = profileId;
				if (profileId === null) return;
				void callback.then(() => refreshActiveProfileSlot(db, options)).catch(() => undefined);
			});
		});
		return () => {
			destroyed = true;
			subscription?.unsubscribe();
		};
	});
</script>

{#if message}
	<div
		class="fixed right-4 bottom-4 z-100 max-w-sm rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground shadow-lg"
		role="alert"
	>
		{message}
	</div>
{/if}

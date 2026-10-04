<script lang="ts">
	import { onMount } from 'svelte';

	import { projectAuthCallback, takeAuthCallbackMarker } from '$lib/client/auth-slot-projection.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';

	let message = $state<string | null>(null);

	onMount(() => {
		const marker = takeAuthCallbackMarker(new URL(window.location.href), (url) =>
			window.history.replaceState(window.history.state, '', url)
		);
		if (!marker) return;

		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
		void getBrowserDatabase()
			.then((database) =>
				projectAuthCallback(database, marker, {
					locale: navigator.language,
					timezone
				})
			)
			.then((outcome) => {
				if (outcome.state === 'reauthRequired') {
					message = 'This profile needs to sign in again. Your local data is still available.';
				} else if (outcome.state === 'stale') {
					message = 'Maal could not verify this profile. Your local data is still available.';
				}
			})
			.catch(() => {
				message = 'Maal could not finish this sign-in. Your local data is still available.';
			});
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

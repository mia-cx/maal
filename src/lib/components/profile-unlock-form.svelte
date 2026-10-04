<script lang="ts">
	import { createAuthSlotId } from '$lib/auth-slots/contracts.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { requestProfilePinReset, switchActiveProfile } from '$lib/client/local/profiles.js';
	import type { AuthSlotRecord } from '$lib/client/local/records.js';
	import type { Profile } from '$lib/domain/household/contracts.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	/** PIN entry for a locked profile, with the online "Forgot PIN?" sign-in that clears the PIN. */
	let {
		database,
		profile,
		slot,
		onopen
	}: {
		database: MaalDatabase;
		profile: Profile;
		slot: AuthSlotRecord | null;
		onopen?: () => void;
	} = $props();

	let pin = $state('');
	let message = $state('');
	let pending = $state(false);

	// Sign-out drops the slot's identity binding, so a signed-out profile signs in on a fresh slot.
	// The projection matches it to this profile by WorkOS user either way.
	const signInHref = $derived(
		slot && slot.sessionState !== 'revoked'
			? `/api/auth-slots/${slot.authSlotId}/authorize?purpose=reauthenticate&returnTo=${encodeURIComponent('/plan')}`
			: `/api/auth-slots/${createAuthSlotId()}/authorize?purpose=add-profile&returnTo=${encodeURIComponent('/plan')}`
	);

	const open = async () => {
		pending = true;
		message = '';
		try {
			await switchActiveProfile(database, profile.profileId, pin);
			pin = '';
			onopen?.();
		} catch {
			message = 'That PIN did not match.';
		} finally {
			pending = false;
		}
	};

	const forgotPin = async () => {
		const nonce = await requestProfilePinReset(database, profile.profileId);
		window.location.assign(`${signInHref}&pinResetNonce=${nonce}`);
	};
</script>

<form
	class="grid gap-3"
	onsubmit={(event) => {
		event.preventDefault();
		void open();
	}}
>
	<Input
		type="password"
		inputmode="numeric"
		pattern="[0-9][0-9][0-9][0-9][0-9]?[0-9]?[0-9]?[0-9]?"
		maxlength={8}
		bind:value={pin}
		autocomplete="off"
		autofocus
		aria-label="Profile PIN"
	/>
	{#if message}<p class="text-sm text-destructive" role="alert">{message}</p>{/if}
	<div class="flex flex-wrap items-center justify-between gap-2">
		<Button type="button" variant="link" class="h-auto px-0" onclick={() => void forgotPin()}>
			Forgot PIN?
		</Button>
		<Button type="submit" disabled={pending}>Open profile</Button>
	</div>
</form>

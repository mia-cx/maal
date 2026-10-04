<script lang="ts">
	import type { AuthSlotRecord } from '$lib/client/local/records.js';
	import type { Profile } from '$lib/domain/household/contracts.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let {
		profile,
		slot,
		pin = $bindable(''),
		busy,
		message,
		error,
		reauthHref,
		addProfileHref,
		onsavepin,
		onremovepin,
		onlock
	}: {
		profile: Profile | null;
		slot: AuthSlotRecord | null;
		pin: string;
		busy: boolean;
		message: string | null;
		error: string | null;
		reauthHref: string | null;
		addProfileHref: string;
		onsavepin: () => void | Promise<void>;
		onremovepin: () => void | Promise<void>;
		onlock: () => void | Promise<void>;
	} = $props();

	const sessionLabel = $derived(
		!profile
			? 'No active profile'
			: profile.authState === 'authenticated'
				? 'Signed in'
				: profile.authState === 'signedOut'
					? 'Signed out locally'
					: 'Reauthentication needed'
	);
</script>

<div class="grid max-w-lg gap-5 text-sm">
	<section class="grid gap-3">
		<div class="grid gap-1">
			<h3 class="text-xs font-medium">Retained account session</h3>
			<p class="text-xs text-muted-foreground">
				Each profile keeps its own path-scoped session. Switching profiles does not replace it.
			</p>
		</div>
		<div
			class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
		>
			<div class="min-w-0">
				<p class="truncate text-xs font-medium">{profile?.displayName ?? 'No active profile'}</p>
				<p class="truncate text-xs text-muted-foreground">
					{sessionLabel}{slot?.lastVerifiedAt
						? ` · checked ${new Date(slot.lastVerifiedAt).toLocaleString()}`
						: ''}
				</p>
			</div>
			{#if reauthHref}
				<Button variant="outline" size="sm" href={reauthHref}>Reauthenticate</Button>
			{/if}
		</div>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="w-fit text-xs font-medium underline underline-offset-4" href={addProfileHref}>
			Add another signed-in profile
		</a>
	</section>

	{#if profile}
		<section class="grid gap-3 border-t border-border pt-4">
			<div class="grid gap-1">
				<h3 class="text-xs font-medium">Profile PIN</h3>
				<p class="text-xs text-muted-foreground">
					A PIN is a casual gate on this device, not encryption. Background sync can continue.
				</p>
			</div>
			<form
				class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
				onsubmit={(event) => {
					event.preventDefault();
					void onsavepin();
				}}
			>
				<Input
					type="password"
					inputmode="numeric"
					pattern="[0-9][0-9][0-9][0-9][0-9]?[0-9]?[0-9]?[0-9]?"
					maxlength={8}
					placeholder="4 to 8 numbers"
					bind:value={pin}
					autocomplete="new-password"
					aria-label="New profile PIN"
				/>
				<Button type="submit" disabled={busy || pin.length < 4}>
					{busy ? 'Saving…' : profile.lockPolicy === 'pin' ? 'Change PIN' : 'Set PIN'}
				</Button>
			</form>
			{#if profile.lockPolicy === 'pin'}
				<div class="flex flex-wrap gap-2">
					<Button type="button" variant="outline" disabled={busy} onclick={() => onlock()}>
						Lock now
					</Button>
					<Button type="button" variant="ghost" disabled={busy} onclick={() => onremovepin()}>
						Remove PIN
					</Button>
				</div>
			{/if}
		</section>
	{/if}

	{#if message}<p class="text-xs text-muted-foreground" aria-live="polite">{message}</p>{/if}
	{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
</div>

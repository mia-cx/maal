<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';
	import LockKeyholeIcon from '@lucide/svelte/icons/lock-keyhole';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { profileLockKey, switchActiveProfile } from '$lib/client/local/profiles.js';
	import { removeLocalProfileFromDevice } from '$lib/client/profile-sessions.js';
	import type { AuthSlotRecord } from '$lib/client/local/records.js';
	import type { Profile } from '$lib/domain/household/contracts.js';
	import ProfileUnlockForm from '$lib/components/profile-unlock-form.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	type ProfileView = { profile: Profile; slot: AuthSlotRecord | null; locked: boolean };

	/** Replaces the app shell while the active profile is locked. Sync keeps running underneath. */
	let { database, profile }: { database: MaalDatabase; profile: Profile } = $props();

	let views = $state<ProfileView[]>([]);
	let targetId = $state<string | null>(null);
	let removeProfile = $state<ProfileView | null>(null);
	let removeOpen = $state(false);
	let pending = $state(false);
	let message = $state('');

	const targetProfileId = $derived(targetId ?? profile.profileId);
	const target = $derived(views.find((view) => view.profile.profileId === targetProfileId));
	const others = $derived(views.filter((view) => view.profile.profileId !== targetProfileId));

	onMount(() => {
		const subscription = liveQuery(async () => {
			const [profiles, slots, locks] = await Promise.all([
				database.profiles.orderBy('lastUsedAt').reverse().toArray(),
				database.authSlots.toArray(),
				database.uiState.filter(({ key }) => key.startsWith('profileLock:')).toArray()
			]);
			const slotsByProfile = new Map(slots.map((slot) => [slot.profileId, slot]));
			const lockedKeys = new Set(locks.filter(({ value }) => value === true).map(({ key }) => key));
			return profiles.map((candidate) => ({
				profile: candidate,
				slot: slotsByProfile.get(candidate.profileId) ?? null,
				locked: lockedKeys.has(profileLockKey(candidate.profileId))
			}));
		}).subscribe((next) => {
			views = next;
		});
		return () => subscription.unsubscribe();
	});

	const choose = async (view: ProfileView) => {
		if (view.locked) {
			targetId = view.profile.profileId;
			return;
		}
		await switchActiveProfile(database, view.profile.profileId);
	};

	const confirmRemoval = async () => {
		if (!removeProfile) return;
		pending = true;
		message = '';
		try {
			await removeLocalProfileFromDevice(database, removeProfile.profile.profileId);
			targetId = null;
			removeOpen = false;
		} catch {
			message = 'This profile could not be removed. Check the connection and try again.';
		} finally {
			pending = false;
		}
	};
</script>

<Dialog.Root bind:open={removeOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title
				>Remove {removeProfile?.profile.displayName ?? 'this profile'} from this device?</Dialog.Title
			>
			<Dialog.Description>
				Private recipes, preferences, and unsent work for this profile will be removed. Household
				data stays when another local member can access it.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-wrap gap-2">
			<Button variant="destructive" disabled={pending} onclick={() => void confirmRemoval()}>
				Remove from this device
			</Button>
		</div>
		{#if message}<p class="text-sm text-destructive" role="alert">{message}</p>{/if}
	</Dialog.Content>
</Dialog.Root>

<div class="grid min-h-svh place-items-center bg-background px-6 text-foreground">
	{#if target}
		<div class="grid w-full max-w-sm gap-4">
			<div class="grid gap-1.5">
				<h1 class="text-lg font-semibold">Open {target.profile.displayName}</h1>
				<p class="text-sm text-muted-foreground">Enter this profile’s local PIN.</p>
			</div>
			{#key target.profile.profileId}
				<ProfileUnlockForm {database} profile={target.profile} slot={target.slot} />
			{/key}
			<Button
				variant="ghost"
				class="justify-self-start text-destructive"
				disabled={pending}
				onclick={() => {
					removeProfile = target ?? null;
					message = '';
					removeOpen = true;
				}}
			>
				<Trash2Icon /> Remove from this device
			</Button>
			{#if others.length > 0}
				<div class="grid gap-2 border-t border-border pt-4">
					<p class="text-xs text-muted-foreground">Other profiles</p>
					{#each others as view (view.profile.profileId)}
						<Button variant="outline" class="justify-start" onclick={() => void choose(view)}>
							<span class="truncate">{view.profile.displayName}</span>
							{#if view.locked}<LockKeyholeIcon class="ms-auto text-muted-foreground" />{/if}
						</Button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

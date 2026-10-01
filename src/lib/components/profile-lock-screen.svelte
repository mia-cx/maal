<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';
	import LockKeyholeIcon from '@lucide/svelte/icons/lock-keyhole';

	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { profileLockKey, switchActiveProfile } from '$lib/client/local/profiles.js';
	import type { AuthSlotRecord } from '$lib/client/local/records.js';
	import type { Profile } from '$lib/domain/household/contracts.js';
	import ProfileUnlockForm from '$lib/components/profile-unlock-form.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type ProfileView = { profile: Profile; slot: AuthSlotRecord | null; locked: boolean };

	/** Replaces the app shell while the active profile is locked. Sync keeps running underneath. */
	let { database, profile }: { database: MaalDatabase; profile: Profile } = $props();

	let views = $state<ProfileView[]>([]);
	let targetId = $state<string | null>(null);

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
</script>

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

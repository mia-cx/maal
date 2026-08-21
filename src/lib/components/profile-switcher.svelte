<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import LockKeyholeIcon from '@lucide/svelte/icons/lock-keyhole';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import PackageOpenIcon from '@lucide/svelte/icons/package-open';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { createAuthSlotId, MAX_AUTHENTICATED_SLOTS } from '$lib/auth-slots/contracts.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import {
		clearProfilePin,
		lockProfile,
		setProfilePin,
		switchActiveProfile
	} from '$lib/client/local/profiles.js';
	import {
		removeLocalProfileFromDevice,
		signOutLocalProfile
	} from '$lib/client/profile-sessions.js';
	import type { AuthSlotRecord } from '$lib/client/local/records.js';
	import type { Profile } from '$lib/domain/household/contracts.js';
	import PortableDataDialog from '$lib/components/portable-data-dialog.svelte';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';

	type ProfileView = { profile: Profile; slot: AuthSlotRecord | null; locked: boolean };

	let {
		database,
		onexport
	}: {
		database: MaalDatabase;
		onexport?: (profileId: string) => void | Promise<void>;
	} = $props();

	const sidebar = useSidebar();
	let views = $state<ProfileView[]>([]);
	let activeProfileId = $state<string | null>(null);
	let unlockProfile = $state<ProfileView | null>(null);
	let manageProfile = $state<ProfileView | null>(null);
	let removeProfile = $state<ProfileView | null>(null);
	let unlockOpen = $state(false);
	let manageOpen = $state(false);
	let removeOpen = $state(false);
	let portableOpen = $state(false);
	let portableProfileId = $state<string | null>(null);
	let pin = $state('');
	let newPin = $state('');
	let message = $state('');
	let pending = $state(false);
	let addSlotId = $state(createAuthSlotId());

	const activeView = $derived(
		views.find(({ profile }) => profile.profileId === activeProfileId) ?? views[0] ?? null
	);
	const retainedSlotCount = $derived(
		views.filter(({ slot }) => slot && slot.sessionState !== 'revoked').length
	);
	const initials = (profile: Profile): string =>
		profile.displayName
			.split(/\s+/)
			.map((part) => part[0] ?? '')
			.join('')
			.slice(0, 2)
			.toUpperCase();
	const addProfileHref = $derived(
		`/api/auth-slots/${addSlotId}/authorize?purpose=add-profile&returnTo=${encodeURIComponent('/plan')}`
	);
	const reauthHref = (view: ProfileView): string | null =>
		view.slot
			? `/api/auth-slots/${view.slot.authSlotId}/authorize?purpose=reauthenticate&returnTo=${encodeURIComponent('/plan')}`
			: null;

	onMount(() => {
		const subscription = liveQuery(async () => {
			const [profiles, slots, active, locks] = await Promise.all([
				database.profiles.orderBy('lastUsedAt').reverse().toArray(),
				database.authSlots.toArray(),
				database.uiState.get('activeProfileId'),
				database.uiState.filter(({ key }) => key.startsWith('profileLock:')).toArray()
			]);
			const slotsByProfile = new Map(slots.map((slot) => [slot.profileId, slot]));
			const lockedIds = new Set(
				locks
					.filter(({ value }) => value === true)
					.map(({ key }) => key.slice('profileLock:'.length))
			);
			return {
				activeProfileId: typeof active?.value === 'string' ? active.value : null,
				views: profiles.map((profile) => ({
					profile,
					slot: slotsByProfile.get(profile.profileId) ?? null,
					locked: lockedIds.has(profile.profileId)
				}))
			};
		}).subscribe(({ activeProfileId: nextActive, views: nextViews }) => {
			activeProfileId = nextActive;
			views = nextViews;
		});
		return () => subscription.unsubscribe();
	});

	const chooseProfile = async (view: ProfileView) => {
		message = '';
		if (view.locked) {
			pin = '';
			unlockProfile = view;
			unlockOpen = true;
			return;
		}
		await switchActiveProfile(database, view.profile.profileId);
	};

	const unlock = async () => {
		if (!unlockProfile) return;
		pending = true;
		message = '';
		try {
			await switchActiveProfile(database, unlockProfile.profile.profileId, pin);
			unlockOpen = false;
			pin = '';
		} catch {
			message = 'That PIN did not match.';
		} finally {
			pending = false;
		}
	};

	const savePin = async () => {
		if (!manageProfile) return;
		pending = true;
		message = '';
		try {
			await setProfilePin(database, manageProfile.profile.profileId, newPin);
			newPin = '';
			manageOpen = false;
		} catch {
			message = 'Use four to eight numbers for the profile PIN.';
		} finally {
			pending = false;
		}
	};

	const removePin = async () => {
		if (!manageProfile) return;
		await clearProfilePin(database, manageProfile.profile.profileId);
		manageOpen = false;
		newPin = '';
	};

	const signOut = async (view: ProfileView) => {
		pending = true;
		message = '';
		try {
			await signOutLocalProfile(database, view.profile.profileId);
		} catch {
			message = 'Sign-out needs a connection. Your local profile is still available.';
		} finally {
			pending = false;
		}
	};

	const confirmRemoval = async () => {
		if (!removeProfile) return;
		pending = true;
		message = '';
		try {
			await removeLocalProfileFromDevice(database, removeProfile.profile.profileId);
			removeOpen = false;
		} catch {
			message = 'This profile could not be removed. Check the connection and try again.';
		} finally {
			pending = false;
		}
	};

	const openPortableData = async (profileId: string) => {
		if (onexport) {
			await onexport(profileId);
			return;
		}
		portableProfileId = profileId;
		portableOpen = true;
	};
</script>

<PortableDataDialog
	{database}
	profileId={portableProfileId ?? activeProfileId}
	bind:open={portableOpen}
/>

<Dialog.Root bind:open={unlockOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Open {unlockProfile?.profile.displayName ?? 'profile'}</Dialog.Title>
			<Dialog.Description>Enter this profile’s local PIN.</Dialog.Description>
		</Dialog.Header>
		<form
			class="grid gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				void unlock();
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
			<Dialog.Footer><Button type="submit" disabled={pending}>Open profile</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={manageOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Profile PIN</Dialog.Title>
			<Dialog.Description>
				This is a casual lock for a shared device, not encryption. Sync can continue while the
				profile is locked.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="grid gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				void savePin();
			}}
		>
			<Input
				type="password"
				inputmode="numeric"
				pattern="[0-9][0-9][0-9][0-9][0-9]?[0-9]?[0-9]?[0-9]?"
				maxlength={8}
				placeholder="4 to 8 numbers"
				bind:value={newPin}
				autocomplete="new-password"
			/>
			{#if message}<p class="text-sm text-destructive" role="alert">{message}</p>{/if}
			<Dialog.Footer>
				{#if manageProfile?.profile.lockPolicy === 'pin'}
					<Button type="button" variant="outline" onclick={() => void removePin()}
						>Remove PIN</Button
					>
				{/if}
				<Button type="submit" disabled={pending || newPin.length < 4}>Save PIN</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

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
			<Button
				variant="outline"
				onclick={() => removeProfile && void openPortableData(removeProfile.profile.profileId)}
			>
				Export data first
			</Button>
			<Button variant="destructive" disabled={pending} onclick={() => void confirmRemoval()}>
				Remove from this device
			</Button>
		</div>
		{#if message}<p class="text-sm text-destructive" role="alert">{message}</p>{/if}
	</Dialog.Content>
</Dialog.Root>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						class="h-9 gap-2 p-0 pe-3 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						{...props}
					>
						{#if activeView}
							<Avatar.Root
								class="size-9 rounded-[calc(var(--radius-sm)+2px)] after:rounded-[calc(var(--radius-sm)+2px)]"
							>
								<Avatar.Image
									src={activeView.profile.profilePictureUrl ?? undefined}
									alt={activeView.profile.displayName}
								/>
								<Avatar.Fallback class="rounded-[calc(var(--radius-sm)+2px)]"
									>{initials(activeView.profile)}</Avatar.Fallback
								>
							</Avatar.Root>
							<div class="grid flex-1 text-start text-sm leading-tight">
								<span class="truncate font-medium">{activeView.profile.displayName}</span>
								<span class="truncate text-xs">{activeView.profile.email ?? 'Offline profile'}</span
								>
							</div>
						{:else}
							<span class="flex size-9 items-center justify-center bg-muted"
								><PlusIcon class="size-4" /></span
							>
							<span class="truncate">Add a profile</span>
						{/if}
						<ChevronsUpDownIcon class="ms-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-64 rounded-lg"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="end"
				sideOffset={4}
			>
				<DropdownMenu.Label class="text-xs text-muted-foreground"
					>Profiles on this device</DropdownMenu.Label
				>
				{#if message}<p class="px-2 py-1 text-xs text-destructive">{message}</p>{/if}
				{#each views as view (view.profile.profileId)}
					<DropdownMenu.Item
						class="gap-2 p-2"
						disabled={view.profile.profileId === activeProfileId}
						onclick={() => void chooseProfile(view)}
					>
						<Avatar.Root class="size-8 rounded-lg after:rounded-lg">
							<Avatar.Image
								src={view.profile.profilePictureUrl ?? undefined}
								alt={view.profile.displayName}
							/>
							<Avatar.Fallback class="rounded-lg">{initials(view.profile)}</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid min-w-0 flex-1">
							<span class="truncate">{view.profile.displayName}</span>
							<span class="truncate text-xs text-muted-foreground">
								{view.profile.authState === 'reauthRequired'
									? 'Reauthentication needed'
									: (view.profile.email ?? 'Offline')}
							</span>
						</div>
						{#if view.locked}<LockKeyholeIcon class="size-4 text-muted-foreground" />{/if}
					</DropdownMenu.Item>
					{#if view.profile.profileId === activeProfileId}
						<DropdownMenu.Group>
							<DropdownMenu.Item onclick={() => void openPortableData(view.profile.profileId)}>
								<PackageOpenIcon /> Import or export data
							</DropdownMenu.Item>
							<DropdownMenu.Item
								onclick={() => {
									manageProfile = view;
									manageOpen = true;
								}}
							>
								<KeyRoundIcon />
								{view.profile.lockPolicy === 'pin' ? 'Change profile PIN' : 'Set profile PIN'}
							</DropdownMenu.Item>
							{#if view.profile.lockPolicy === 'pin'}
								<DropdownMenu.Item
									onclick={() => void lockProfile(database, view.profile.profileId)}
								>
									<LockKeyholeIcon /> Lock profile
								</DropdownMenu.Item>
							{/if}
							{#if view.profile.authState === 'reauthRequired' && reauthHref(view)}
								<DropdownMenu.Item>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
									<a class="flex w-full items-center gap-2" href={reauthHref(view)!}
										><RefreshCwIcon /> Reauthenticate</a
									>
								</DropdownMenu.Item>
							{/if}
							{#if view.profile.authState !== 'signedOut'}
								<DropdownMenu.Item onclick={() => void signOut(view)}
									><LogOutIcon /> Sign out</DropdownMenu.Item
								>
							{/if}
							<DropdownMenu.Item
								class="text-destructive"
								onclick={() => {
									removeProfile = view;
									removeOpen = true;
								}}><Trash2Icon /> Remove from this device</DropdownMenu.Item
							>
						</DropdownMenu.Group>
					{/if}
				{/each}
				<DropdownMenu.Separator />
				{#if retainedSlotCount < MAX_AUTHENTICATED_SLOTS}
					<DropdownMenu.Item>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a class="flex w-full items-center gap-2" href={addProfileHref}
							><PlusIcon /> Add profile</a
						>
					</DropdownMenu.Item>
				{:else}
					<DropdownMenu.Item disabled class="items-start gap-2 p-2">
						<PlusIcon class="mt-0.5" />
						<span>Eight signed-in profiles are already retained. Remove one to add another.</span>
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

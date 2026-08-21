<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';
	import { uuidv7 } from 'uuidv7';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';

	import * as m from '$lib/paraglide/messages.js';
	import { recoverHousehold, requestHouseholdDeletion } from '$lib/client/billing.js';
	import {
		createHouseholdInvite,
		leaveRemoteHousehold,
		removeHouseholdMember,
		refreshRemoteHousehold,
		revokeHouseholdInvite,
		updateHouseholdMemberRole,
		type CreatedHouseholdInvite
	} from '$lib/client/household-administration.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import {
		forkDetachedHouseholdSnapshot,
		updateHouseholdAppliances,
		updateHouseholdSettings
	} from '$lib/client/local/households.js';
	import type { HouseholdInviteRecord } from '$lib/client/local/records.js';
	import { applianceLabels } from '$lib/domain/household/appliances.js';
	import {
		applianceValues,
		type Appliance,
		type Household,
		type HouseholdRole,
		type Membership,
		type Profile
	} from '$lib/domain/household/contracts.js';
	import { hasCachedPermission } from '$lib/domain/household/permissions.js';
	import { inviteExpiryDays } from '$lib/domain/household/settings-parsing.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import BillingSettingsSection from '$lib/components/settings/billing-settings-section.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	type ApplianceView = {
		id: string;
		appliance: Appliance;
		label: string;
		available: boolean;
		notes: string;
	};
	type MemberView = Membership & {
		name: string;
		email: string | null;
		localProfileId: string | null;
	};

	let {
		database,
		profileId,
		householdId,
		onexport
	}: {
		database: MaalDatabase;
		profileId: string;
		householdId: string;
		onexport?: (householdId: string) => void | Promise<void>;
	} = $props();

	let household = $state<Household | null>(null);
	let membership = $state<Membership | null>(null);
	let members = $state<MemberView[]>([]);
	let invites = $state<HouseholdInviteRecord[]>([]);
	let profile = $state<Profile | null>(null);
	let appliances = $state<ApplianceView[]>([]);
	let loadedRevision = $state<string | null>(null);
	let name = $state('');
	let locale = $state('en-US');
	let timezone = $state('');
	let weekStartsOn = $state<'0' | '1'>('1');
	let defaultPlannedYield = $state('4');
	let preferredDinnerTime = $state('');
	let message = $state('');
	let pending = $state(false);
	let inviteOpen = $state(false);
	let inviteRole = $state<HouseholdRole>('member');
	let inviteExpiresInDays = $state<'1' | '7' | '30'>('7');
	let inviteMaxUses = $state('');
	let createdInvite = $state<CreatedHouseholdInvite | null>(null);
	let removeMemberOpen = $state(false);
	let memberToRemove = $state<MemberView | null>(null);
	let leaveHouseholdOpen = $state(false);
	let forkOpen = $state(false);
	let forkName = $state('');
	let deleteHouseholdOpen = $state(false);
	let remoteRefreshStarted = false;

	const canManage = $derived(
		household?.localOnly || hasCachedPermission(membership ?? undefined, 'households:write')
	);
	const readOnly = $derived(membership?.status === 'detached' || !canManage);
	const isDetached = $derived(membership?.status === 'detached');
	const activeAdminCount = $derived(
		members.filter((candidate) => candidate.status === 'active' && candidate.roleSlug === 'admin')
			.length
	);
	const canLeave = $derived(
		Boolean(
			membership &&
			membership.status === 'active' &&
			membership.source === 'workos' &&
			!membership.directoryManaged &&
			!(membership.roleSlug === 'admin' && activeAdminCount <= 1)
		)
	);
	const leaveDisabledReason = $derived(
		membership?.directoryManaged
			? 'Directory-managed members must leave through the identity provider.'
			: membership?.roleSlug === 'admin' && activeAdminCount <= 1
				? 'You are the last manager. Add another manager or delete the household instead.'
				: null
	);
	const transferCandidates = $derived(
		members
			.filter(
				(member) =>
					member.status === 'active' &&
					member.roleSlug === 'admin' &&
					member.workosUserId !== profile?.workosUserId
			)
			.map(({ workosUserId, name }) => ({ workosUserId, name }))
	);
	const roleOptions = [
		{ value: 'admin', label: m.household_role_manager() },
		{ value: 'member', label: m.household_role_adult() },
		{ value: 'child', label: m.household_role_child() }
	] as const;
	const roleLabel = (role: string): string =>
		roleOptions.find((option) => option.value === role)?.label ?? role;
	const inviteExpiryOptions = inviteExpiryDays.map((days) => ({
		value: String(days) as '1' | '7' | '30',
		label: m.household_invite_expiry_option({
			days: String(days),
			unit: days === 1 ? m.household_day() : m.household_days()
		})
	}));

	onMount(() => {
		const subscription = liveQuery(async () => {
			const [
				nextHousehold,
				nextProfile,
				nextAppliances,
				nextMembers,
				nextInvites,
				profiles,
				attributions
			] = await Promise.all([
				database.households.get(householdId),
				database.profiles.get(profileId),
				database.householdAppliances.where('householdId').equals(householdId).toArray(),
				database.memberships.where('householdId').equals(householdId).toArray(),
				database.householdInvites.where('householdId').equals(householdId).toArray(),
				database.profiles.toArray(),
				database.userAttributions.toArray()
			]);
			const nextMembership = nextProfile
				? nextMembers.find(({ workosUserId }) => workosUserId === nextProfile.workosUserId)
				: undefined;
			const profilesByUser = new Map(
				profiles.map((candidate) => [candidate.workosUserId, candidate])
			);
			const attributionsByUser = new Map(
				attributions.map((candidate) => [candidate.workosUserId, candidate])
			);
			return {
				household: nextHousehold ?? null,
				profile: nextProfile ?? null,
				membership: nextMembership ?? null,
				members: nextMembers.map((candidate) => {
					const local = profilesByUser.get(candidate.workosUserId);
					const attribution = attributionsByUser.get(candidate.workosUserId);
					return {
						...candidate,
						name: local?.displayName ?? attribution?.displayName ?? candidate.workosUserId,
						email: local?.email ?? attribution?.email ?? null,
						localProfileId: local?.profileId ?? null
					};
				}),
				invites: nextInvites,
				appliances: applianceValues.map((appliance) => {
					const stored = nextAppliances.find((candidate) => candidate.appliance === appliance);
					return {
						id: stored?.id ?? uuidv7(),
						appliance,
						label: applianceLabels[appliance],
						available: stored?.available ?? false,
						notes: stored?.notes ?? ''
					};
				})
			};
		}).subscribe((value) => {
			household = value.household;
			profile = value.profile;
			membership = value.membership;
			members = value.members;
			invites = value.invites;
			appliances = value.appliances;
			if (
				value.household &&
				loadedRevision !== `${value.household.householdId}:${value.household.revision}`
			) {
				loadedRevision = `${value.household.householdId}:${value.household.revision}`;
				name = value.household.name;
				locale = value.household.locale;
				timezone = value.household.timezone ?? '';
				weekStartsOn = String(value.household.weekStartsOn) as '0' | '1';
				defaultPlannedYield = String(value.household.defaultPlannedYield);
				preferredDinnerTime = value.household.preferredDinnerTime ?? '';
			}
			if (
				!remoteRefreshStarted &&
				value.household &&
				!value.household.localOnly &&
				value.membership?.status === 'active'
			) {
				remoteRefreshStarted = true;
				void refreshRemoteHousehold(database, profileId, householdId).catch(() => {
					message = 'The latest household members and invites could not be loaded.';
				});
			}
		});
		return () => subscription.unsubscribe();
	});

	const saveSettings = async () => {
		if (!household) return;
		pending = true;
		message = '';
		try {
			await updateHouseholdSettings(database, {
				profileId,
				householdId,
				patch: {
					name: name.trim(),
					locale: locale.trim(),
					timezone: timezone.trim() || null,
					weekStartsOn: Number(weekStartsOn) as 0 | 1,
					defaultPlannedYield: Number(defaultPlannedYield),
					preferredDinnerTime: preferredDinnerTime || null
				}
			});
			message = 'Household settings saved.';
		} catch {
			message = m.household_could_not_update_household_settings();
		} finally {
			pending = false;
		}
	};

	const saveAppliances = async () => {
		pending = true;
		message = '';
		try {
			await updateHouseholdAppliances(database, {
				profileId,
				householdId,
				appliances: appliances.map(({ id, appliance, available, notes }) => ({
					id,
					appliance,
					available,
					notes: notes.trim() || null
				}))
			});
			message = m.household_appliances_saved();
		} catch {
			message = m.household_could_not_update_appliances();
		} finally {
			pending = false;
		}
	};

	const createInvite = async () => {
		if (!household || household.localOnly) return;
		pending = true;
		message = '';
		try {
			createdInvite = await createHouseholdInvite(database, profileId, {
				householdId,
				roleSlug: inviteRole,
				expiresInDays: Number(inviteExpiresInDays) as 1 | 7 | 30,
				maxUses: inviteMaxUses ? Number(inviteMaxUses) : null
			});
		} catch {
			message = m.household_could_not_create_invite_link();
		} finally {
			pending = false;
		}
	};

	const copyInvite = async () => {
		if (!createdInvite) return;
		await navigator.clipboard.writeText(createdInvite.code);
		message = m.household_invite_url_copied();
	};

	const changeRole = async (member: MemberView, roleSlug: HouseholdRole) => {
		try {
			await updateHouseholdMemberRole(database, profileId, {
				householdId,
				membershipId: member.membershipId,
				roleSlug
			});
		} catch {
			message = m.household_could_not_update_member_role();
		}
	};

	const confirmMemberRemoval = async () => {
		if (!memberToRemove) return;
		pending = true;
		try {
			await removeHouseholdMember(database, profileId, householdId, memberToRemove.membershipId);
			removeMemberOpen = false;
		} catch {
			message = m.household_could_not_remove_member();
		} finally {
			pending = false;
		}
	};

	const revokeInvite = async (inviteId: string) => {
		try {
			await revokeHouseholdInvite(database, profileId, householdId, inviteId);
		} catch {
			message = m.household_could_not_revoke_invite();
		}
	};

	const leaveHousehold = async () => {
		pending = true;
		message = '';
		try {
			await leaveRemoteHousehold(database, profileId, householdId);
			leaveHouseholdOpen = false;
			message = 'You left the household. The local snapshot remains available to export.';
		} catch {
			message = m.household_could_not_leave_household();
		} finally {
			pending = false;
		}
	};

	const forkSnapshot = async () => {
		pending = true;
		try {
			await forkDetachedHouseholdSnapshot(database, {
				profileId,
				householdId,
				name: forkName
			});
			forkOpen = false;
		} catch {
			message = 'The detached snapshot could not be copied.';
		} finally {
			pending = false;
		}
	};

	const deleteHousehold = async () => {
		pending = true;
		message = '';
		try {
			await requestHouseholdDeletion(database, profileId, householdId);
			deleteHouseholdOpen = false;
			message =
				'The subscription was cancelled and any prorated cash refund was requested. This household can be recovered for 30 days.';
		} catch {
			message =
				'Household deletion could not finish. No remote data was purged; retry to resume the cancellation and refund.';
		} finally {
			pending = false;
		}
	};

	const recoverDeletion = async () => {
		pending = true;
		message = '';
		try {
			await recoverHousehold(database, profileId, householdId);
			message = 'Household recovered. Its previous subscription was not recreated.';
		} catch {
			message = 'The household could not be recovered. The 30-day recovery window may have ended.';
		} finally {
			pending = false;
		}
	};
</script>

<Dialog.Root bind:open={inviteOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.household_invite_people_to_your_household()}</Dialog.Title>
			<Dialog.Description>
				{household ? m.household_invite_description({ householdName: household.name }) : ''}
			</Dialog.Description>
		</Dialog.Header>
		{#if createdInvite}
			<div class="grid gap-3 rounded-md border border-border bg-muted/20 p-3">
				<p class="text-xs font-medium text-muted-foreground">
					Share this code now. Maal will not store it.
				</p>
				<p class="font-mono text-lg font-semibold tracking-[0.2em]">{createdInvite.code}</p>
				<Button type="button" variant="outline" onclick={() => void copyInvite()}
					>{m.household_copy_url()}</Button
				>
			</div>
		{:else}
			<form
				class="grid gap-4"
				onsubmit={(event) => {
					event.preventDefault();
					void createInvite();
				}}
			>
				<label class="grid gap-1 text-xs font-medium">
					{m.household_role()}
					<Select.Root type="single" bind:value={inviteRole}>
						<Select.Trigger class="!h-9 w-full text-sm">{roleLabel(inviteRole)}</Select.Trigger>
						<Select.Content
							>{#each roleOptions as role (role.value)}<Select.Item value={role.value}
									>{role.label}</Select.Item
								>{/each}</Select.Content
						>
					</Select.Root>
				</label>
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="grid gap-1 text-xs font-medium">
						{m.household_max_uses()}
						<Input
							type="number"
							min="1"
							max="100"
							placeholder={m.household_unlimited()}
							bind:value={inviteMaxUses}
						/>
					</label>
					<label class="grid gap-1 text-xs font-medium">
						{m.household_expires()}
						<Select.Root type="single" bind:value={inviteExpiresInDays}>
							<Select.Trigger class="!h-9 w-full text-sm"
								>{inviteExpiresInDays}
								{inviteExpiresInDays === '1'
									? m.household_day()
									: m.household_days()}</Select.Trigger
							>
							<Select.Content
								>{#each inviteExpiryOptions as option (option.value)}<Select.Item
										value={option.value}>{option.label}</Select.Item
									>{/each}</Select.Content
							>
						</Select.Root>
					</label>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (inviteOpen = false)}
						>{m.settings_cancel()}</Button
					>
					<Button type="submit" disabled={pending}>{m.household_create_invite_link()}</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={leaveHouseholdOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.household_leave_household_2()}</Dialog.Title>
			<Dialog.Description>
				{household ? m.household_leave_description({ householdName: household.name }) : ''}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (leaveHouseholdOpen = false)}
				>{m.settings_cancel()}</Button
			>
			<Button
				type="button"
				variant="destructive"
				disabled={pending}
				onclick={() => void leaveHousehold()}>{m.household_leave_household()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteHouseholdOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.household_delete_household_2()}</Dialog.Title>
			<Dialog.Description>
				Maal will cancel the subscription, issue a prorated cash refund for unused paid time, and
				keep the remote household recoverable for 30 days. Local data remains available.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (deleteHouseholdOpen = false)}
				>{m.settings_cancel()}</Button
			>
			<Button
				type="button"
				variant="destructive"
				disabled={pending}
				onclick={() => void deleteHousehold()}
			>
				{pending ? 'Cancelling and refunding…' : m.household_delete_household()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={removeMemberOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.household_remove_member()}</Dialog.Title>
			<Dialog.Description
				>{m.household_remove_member_description({
					name: memberToRemove?.name ?? m.household_this_member()
				})}</Dialog.Description
			>
		</Dialog.Header>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (removeMemberOpen = false)}
				>{m.settings_cancel()}</Button
			>
			<Button
				type="button"
				variant="destructive"
				disabled={pending}
				onclick={() => void confirmMemberRemoval()}>{m.settings_remove()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={forkOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Make an editable local copy?</Dialog.Title>
			<Dialog.Description
				>The detached snapshot stays untouched. Meals and check-ins receive new IDs in a new local
				household.</Dialog.Description
			>
		</Dialog.Header>
		<Input bind:value={forkName} aria-label="New household name" />
		<Dialog.Footer
			><Button type="button" disabled={pending} onclick={() => void forkSnapshot()}
				>Make local copy</Button
			></Dialog.Footer
		>
	</Dialog.Content>
</Dialog.Root>

{#if household && profile && membership}
	<div class="mx-auto grid w-full max-w-4xl gap-6 px-4 py-5 md:px-6">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-xl font-semibold tracking-tight">{m.household_household_settings()}</h1>
			{#if readOnly}<p class="text-xs text-muted-foreground">{m.household_read_only()}</p>{/if}
		</div>

		{#if isDetached}
			<section class="grid gap-3 rounded-md border border-border bg-muted/30 p-4">
				<div class="grid gap-1">
					<h2 class="text-sm font-semibold">Detached household snapshot</h2>
					<p class="text-xs text-muted-foreground">
						Your former membership no longer authorizes sync. This local copy remains readable and
						exportable.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button type="button" variant="outline" onclick={() => void onexport?.(householdId)}
						>Export snapshot</Button
					>
					<Button
						type="button"
						onclick={() => {
							forkName = `${household?.name ?? 'Household'} copy`;
							forkOpen = true;
						}}>Make editable copy</Button
					>
				</div>
			</section>
		{/if}

		{#if message}<p
				class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
				aria-live="polite"
			>
				{message}
			</p>{/if}

		<section
			class="grid gap-3 border-t border-border pt-4"
			aria-label={m.household_basic_settings()}
		>
			<form
				class="grid gap-4"
				onsubmit={(event) => {
					event.preventDefault();
					void saveSettings();
				}}
			>
				<label class="grid min-w-0 gap-1 text-xs font-medium">
					{m.settings_name()}
					<Input bind:value={name} maxlength={120} readonly={readOnly} class="h-8 w-full" />
				</label>
				<div class="grid gap-3 md:grid-cols-3">
					<label class="grid min-w-0 gap-1 text-xs font-medium"
						>{m.household_locale()}<Input
							bind:value={locale}
							readonly={readOnly}
							class="h-8"
						/></label
					>
					<label class="grid min-w-0 gap-1 text-xs font-medium"
						>{m.household_timezone()}<Input
							bind:value={timezone}
							readonly={readOnly}
							class="h-8"
						/></label
					>
					<label class="grid min-w-0 gap-1 text-xs font-medium">
						{m.household_start_of_week()}
						<Select.Root type="single" bind:value={weekStartsOn} disabled={readOnly}>
							<Select.Trigger class="!h-8 w-full"
								>{weekStartsOn === '0'
									? m.household_sunday()
									: m.household_monday()}</Select.Trigger
							>
							<Select.Content
								><Select.Item value="0">{m.household_sunday()}</Select.Item><Select.Item value="1"
									>{m.household_monday()}</Select.Item
								></Select.Content
							>
						</Select.Root>
					</label>
				</div>
				<div class="grid gap-3 md:grid-cols-2">
					<label class="grid min-w-0 gap-1 text-xs font-medium"
						>{m.household_default_yield()}<Input
							type="number"
							min="1"
							max="24"
							bind:value={defaultPlannedYield}
							readonly={readOnly}
							class="h-8"
						/></label
					>
					<label class="grid min-w-0 gap-1 text-xs font-medium"
						>{m.household_preferred_dinner_time()}<Input
							type="time"
							bind:value={preferredDinnerTime}
							readonly={readOnly}
							class="h-8"
						/></label
					>
				</div>
				{#if canManage}<div>
						<Button type="submit" disabled={pending}>{m.household_save_household()}</Button>
					</div>{/if}
			</form>
		</section>

		<section class="grid gap-3 border-t border-border pt-4">
			<h2 class="text-sm font-medium">{m.household_appliances()}</h2>
			<div class="flex flex-wrap gap-2">
				{#each appliances as appliance (appliance.appliance)}
					<label
						class={cn(
							'inline-flex min-h-10 items-center rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm transition-colors',
							appliance.available
								? 'border-primary bg-primary/10 text-foreground ring-2 ring-primary/30 hover:bg-primary/15'
								: 'border-border bg-muted/30 text-muted-foreground hover:border-foreground/30 hover:bg-muted/50',
							readOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
						)}
					>
						<input
							type="checkbox"
							bind:checked={appliance.available}
							disabled={readOnly}
							class="sr-only"
						/>
						{appliance.label}
					</label>
				{/each}
			</div>
			{#if canManage}<div>
					<Button type="button" disabled={pending} onclick={() => void saveAppliances()}
						>{m.household_save_appliances()}</Button
					>
				</div>{/if}
		</section>

		{#if canManage}
			<BillingSettingsSection
				{database}
				{profileId}
				{householdId}
				householdName={household.name}
				workosUserId={profile.workosUserId}
				localOnly={household.localOnly}
				{transferCandidates}
			/>
		{/if}

		<section class="grid gap-3 border-t border-border pt-4">
			<div class="grid gap-1">
				<h2 class="text-sm font-medium">{m.household_members()}</h2>
				<p class="text-xs text-muted-foreground">
					{m.household_manage_access_description({ householdName: household.name })}
				</p>
			</div>
			<div class="divide-y divide-border rounded-md border border-border">
				{#each members as member (member.membershipId)}
					<div class="grid gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{member.name}</p>
							<p class="truncate text-xs text-muted-foreground">
								{member.email || member.workosUserId}
							</p>
						</div>
						<div class="flex items-center justify-end gap-2">
							{#if canManage && !member.directoryManaged && member.workosUserId !== profile.workosUserId && !household.localOnly}
								<select
									class="h-8 rounded-md border border-input bg-background px-2 text-xs"
									value={member.roleSlug}
									onchange={(event) =>
										void changeRole(member, event.currentTarget.value as HouseholdRole)}
								>
									{#each roleOptions as role (role.value)}<option value={role.value}
											>{role.label}</option
										>{/each}
								</select>
							{:else}<span class="text-xs text-muted-foreground">{roleLabel(member.roleSlug)}</span
								>{/if}
							{#if member.workosUserId === profile.workosUserId}<span
									class="text-xs text-muted-foreground">{m.household_you()}</span
								>{/if}
							{#if member.directoryManaged}<span class="text-xs text-muted-foreground"
									>{m.household_managed_by_idp()}</span
								>{/if}
							{#if canManage && !member.directoryManaged && member.workosUserId !== profile.workosUserId && !household.localOnly}
								<DropdownMenu.Root>
									<DropdownMenu.Trigger
										class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
										aria-label={`Actions for ${member.name}`}
										><EllipsisIcon class="size-4" /></DropdownMenu.Trigger
									>
									<DropdownMenu.Content align="end" class="w-36"
										><DropdownMenu.Item
											variant="destructive"
											onclick={() => {
												memberToRemove = member;
												removeMemberOpen = true;
											}}>{m.menu_remove()}</DropdownMenu.Item
										></DropdownMenu.Content
									>
								</DropdownMenu.Root>
							{/if}
						</div>
					</div>
				{/each}
				{#if invites.length > 0}
					<div
						class="bg-muted/20 px-3 py-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase"
					>
						{m.household_invites()}
					</div>
					{#each invites as invite (invite.id)}
						<div
							class={cn(
								'grid gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
								invite.revokedAt && 'opacity-55'
							)}
						>
							<div>
								<p class="text-sm font-medium">{m.household_invite()}</p>
								<p class="text-xs text-muted-foreground">
									{roleLabel(invite.roleSlug)} · {invite.usesCount}{invite.maxUses === null
										? ''
										: ` / ${invite.maxUses}`} · {new Date(invite.expiresAt).toLocaleDateString()}
								</p>
							</div>
							{#if canManage && !invite.revokedAt}<Button
									type="button"
									variant="ghost"
									onclick={() => void revokeInvite(invite.id)}>{m.household_revoke()}</Button
								>{/if}
						</div>
					{/each}
				{/if}
			</div>
			{#if canManage && !household.localOnly}<div>
					<Button
						type="button"
						variant="outline"
						onclick={() => {
							createdInvite = null;
							inviteOpen = true;
						}}>{m.household_invite_people_to_your_household()}</Button
					>
				</div>{/if}
		</section>

		<section class="grid gap-3 border-t border-border pt-4">
			<h2 class="text-sm font-medium">{m.household_danger_zone()}</h2>
			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={!canLeave}
					title={leaveDisabledReason ?? undefined}
					onclick={() => (leaveHouseholdOpen = true)}>{m.household_leave_household()}</Button
				>
				{#if canManage && !household.localOnly}
					{#if household.deletionState === 'recoverable'}
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onclick={() => void recoverDeletion()}>Recover household</Button
						>
					{:else}
						<Button
							type="button"
							variant="destructive"
							disabled={pending}
							onclick={() => (deleteHouseholdOpen = true)}>{m.household_delete_household()}</Button
						>
					{/if}
				{/if}
			</div>
			{#if !canLeave && leaveDisabledReason}<p class="text-xs text-muted-foreground">
					{leaveDisabledReason}
				</p>{/if}
			<p class="text-xs text-muted-foreground">
				Household deletion is available after its Maal plan is cancelled and any refund is complete.
			</p>
		</section>
	</div>
{:else}
	<div class="grid min-h-64 place-items-center px-6 text-center">
		<p class="text-sm text-muted-foreground">
			This household is not available to the active profile.
		</p>
	</div>
{/if}

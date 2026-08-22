<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import { createAuthSlotId } from '$lib/auth-slots/contracts.js';
	import {
		createMcpKey,
		listCachedMcpKeys,
		listMcpKeys,
		rerollMcpKey,
		revokeMcpKey
	} from '$lib/client/mcp-keys.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import {
		activeHouseholdKey,
		clearProfilePin,
		lockProfile,
		setProfilePin,
		switchActiveProfile
	} from '$lib/client/local/profiles.js';
	import type { AuthSlotRecord } from '$lib/client/local/records.js';
	import AccountSettingsSection from '$lib/components/settings/account-settings-section.svelte';
	import BillingSettingsSection from '$lib/components/settings/billing-settings-section.svelte';
	import McpSettingsSection from '$lib/components/settings/mcp-settings-section.svelte';
	import SecuritySettingsSection from '$lib/components/settings/security-settings-section.svelte';
	import SettingsCategoryNav from '$lib/components/settings/settings-category-nav.svelte';
	import SettingsSectionHeading from '$lib/components/settings/settings-section-heading.svelte';
	import DeleteConfirmDialog from '$lib/components/delete-confirm-dialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { BillingCapability } from '$lib/domain/billing/contracts.js';
	import type { Household, Membership, Profile } from '$lib/domain/household/contracts.js';
	import {
		filterMcpHouseholds,
		mcpHouseholdPickerLabel as formatMcpHouseholdPickerLabel,
		scopeLevelsForScopes,
		scopesForPreset,
		selectedMcpHouseholds as selectMcpHouseholds,
		selectedMcpScopesForLevels,
		setMcpScopeReadLevel,
		setMcpScopeWriteLevel,
		toggleMcpHouseholdId,
		type McpKey,
		type McpKeyPreset,
		type McpScopeGroupId,
		type McpScopeLevels
	} from '$lib/settings/mcp-key-model.js';
	import {
		settingsCategories,
		settingsCategoryFromParam,
		type SettingsCategory
	} from '$lib/settings/categories.js';
	import type { SettingsCategoryId, SettingsHousehold } from '$lib/settings/types.js';

	type SettingsView = {
		profiles: readonly Profile[];
		activeProfile: Profile | null;
		activeSlot: AuthSlotRecord | null;
		activeHousehold: Household | null;
		activeMembership: Membership | null;
		mcpHouseholds: SettingsHousehold[];
		mcpPaidAccess: boolean;
		transferCandidates: readonly { workosUserId: string; name: string }[];
	};

	let { database }: { database: MaalDatabase } = $props();

	let open = $state(false);
	let activeCategory = $state<SettingsCategoryId>('account');
	let view = $state<SettingsView>({
		profiles: [],
		activeProfile: null,
		activeSlot: null,
		activeHousehold: null,
		activeMembership: null,
		mcpHouseholds: [],
		mcpPaidAccess: false,
		transferCandidates: []
	});
	let navigationError = $state<string | null>(null);
	let lastSettingsUrlParam = $state<string | null>(null);
	let categoryNavigationRequestId = 0;

	let switchingProfileId = $state<string | null>(null);
	let profileError = $state<string | null>(null);
	let pin = $state('');
	let securityBusy = $state(false);
	let securityMessage = $state<string | null>(null);
	let securityError = $state<string | null>(null);

	let mcpKeys = $state<McpKey[]>([]);
	let mcpOwnerUserId = $state<string | null>(null);
	let mcpKeysLoaded = $state(false);
	let mcpKeysBusy = $state(false);
	let mcpKeyCreating = $state(false);
	let mcpKeyFormOpen = $state(false);
	let mcpKeyLabel = $state('');
	let mcpKeyPreset = $state<'custom' | McpKeyPreset>('read_only_planner');
	let mcpScopeLevels = $state<McpScopeLevels>(
		scopeLevelsForScopes(scopesForPreset('read_only_planner'))
	);
	let mcpKeyHouseholdKind = $state<'all' | 'households'>('households');
	let mcpKeyHouseholdIds = $state<string[]>([]);
	let mcpHouseholdPickerOpen = $state(false);
	let mcpHouseholdQuery = $state('');
	let createdMcpKey = $state<string | null>(null);
	let mcpMessage = $state<string | null>(null);
	let mcpError = $state<string | null>(null);
	let mcpKeyToRevoke = $state<McpKey | null>(null);
	let mcpRevokeOpen = $state(false);
	let revokingMcpKeyId = $state<string | null>(null);
	let rerollingMcpKeyId = $state<string | null>(null);

	const categories: SettingsCategory[] = settingsCategories;
	const activeCategoryDetails = $derived(
		categories.find((category) => category.id === activeCategory) ?? categories[0]
	);
	const selectedMcpScopes = $derived(selectedMcpScopesForLevels(mcpScopeLevels));
	const selectedMcpHouseholds = $derived(
		selectMcpHouseholds(view.mcpHouseholds, mcpKeyHouseholdIds)
	);
	const mcpHouseholdPickerLabel = $derived(formatMcpHouseholdPickerLabel(selectedMcpHouseholds));
	const filteredMcpHouseholds = $derived(
		filterMcpHouseholds(view.mcpHouseholds, mcpHouseholdQuery)
	);
	const mcpServerUrl = $derived(`${page.url.origin}/mcp`);
	const reauthHref = $derived(
		view.activeSlot && view.activeProfile?.authState !== 'authenticated'
			? `/api/auth-slots/${view.activeSlot.authSlotId}/authorize?purpose=reauthenticate&returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
			: null
	);
	const addProfileHref = $derived(
		`/api/auth-slots/${createAuthSlotId()}/authorize?purpose=add-profile&returnTo=${encodeURIComponent('/plan?settings=account')}`
	);

	const readView = async (): Promise<SettingsView> => {
		const active = await database.uiState.get('activeProfileId');
		const activeProfileId = typeof active?.value === 'string' ? active.value : null;
		const [profiles, activeProfile] = await Promise.all([
			database.profiles.orderBy('lastUsedAt').reverse().toArray(),
			activeProfileId ? database.profiles.get(activeProfileId) : undefined
		]);
		if (!activeProfile) {
			return {
				profiles,
				activeProfile: null,
				activeSlot: null,
				activeHousehold: null,
				activeMembership: null,
				mcpHouseholds: [],
				mcpPaidAccess: false,
				transferCandidates: []
			};
		}
		const activeHouseholdState = await database.uiState.get(
			activeHouseholdKey(activeProfile.profileId)
		);
		const activeHouseholdId =
			typeof activeHouseholdState?.value === 'string' ? activeHouseholdState.value : null;
		const [activeSlot, memberships, households, capabilities] = await Promise.all([
			database.authSlots.where('profileId').equals(activeProfile.profileId).first(),
			database.memberships.where('workosUserId').equals(activeProfile.workosUserId).toArray(),
			database.households.toArray(),
			database.billingCapabilities.toArray()
		]);
		const householdById = new Map(
			households.map((household) => [household.householdId, household])
		);
		const activeHousehold = activeHouseholdId
			? (householdById.get(activeHouseholdId) ?? null)
			: null;
		const activeMembership =
			memberships.find(
				(membership) =>
					membership.householdId === activeHouseholdId && membership.status === 'active'
			) ?? null;
		const activeMemberships = memberships.filter(({ status }) => status === 'active');
		const accessibleIds = new Set(activeMemberships.map(({ householdId }) => householdId));
		const mcpHouseholds = households
			.filter(
				(household) =>
					accessibleIds.has(household.householdId) &&
					!household.localOnly &&
					household.deletionState === 'active'
			)
			.map((household) => ({ id: household.householdId, name: household.name }));
		const capabilityByHousehold = new Map(
			capabilities.map((capability) => [capability.householdId, capability] as const)
		);
		const mcpPaidAccess = mcpHouseholds.some(({ id }) => {
			const capability: BillingCapability | undefined = capabilityByHousehold.get(id);
			return capability?.state === 'enabled' || capability?.state === 'grace';
		});
		const activeHouseholdMemberships = activeHouseholdId
			? await database.memberships.where('householdId').equals(activeHouseholdId).toArray()
			: [];
		const profileByUserId = new Map(profiles.map((profile) => [profile.workosUserId, profile]));
		return {
			profiles,
			activeProfile,
			activeSlot: activeSlot ?? null,
			activeHousehold,
			activeMembership,
			mcpHouseholds,
			mcpPaidAccess,
			transferCandidates: activeHouseholdMemberships
				.filter(
					(membership) =>
						membership.status === 'active' &&
						membership.roleSlug === 'admin' &&
						membership.workosUserId !== activeProfile.workosUserId
				)
				.map((membership) => ({
					workosUserId: membership.workosUserId,
					name: profileByUserId.get(membership.workosUserId)?.displayName ?? membership.workosUserId
				}))
		};
	};

	onMount(() => {
		const subscription = liveQuery(readView).subscribe((next) => {
			const nextOwner = next.activeProfile?.workosUserId ?? null;
			if (nextOwner !== mcpOwnerUserId) {
				mcpOwnerUserId = nextOwner;
				mcpKeys = [];
				mcpKeysLoaded = false;
				createdMcpKey = null;
				void (next.activeProfile
					? listCachedMcpKeys(database, next.activeProfile.profileId).then((keys) => {
							if (mcpOwnerUserId === nextOwner) mcpKeys = keys;
						})
					: Promise.resolve());
			}
			view = next;
			if (mcpKeyHouseholdIds.length === 0 && next.mcpHouseholds[0]) {
				mcpKeyHouseholdIds = [next.mcpHouseholds[0].id];
			}
		});
		return () => subscription.unsubscribe();
	});

	const chooseCategory = async (category: SettingsCategory) => {
		if (category.disabled) return;
		const requestId = ++categoryNavigationRequestId;
		const previousCategory = activeCategory;
		activeCategory = category.id;
		navigationError = null;
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.set('settings', category.id);
		try {
			await goto(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, {
				keepFocus: true,
				noScroll: true,
				replaceState: true
			});
			if (requestId === categoryNavigationRequestId) lastSettingsUrlParam = category.id;
		} catch {
			if (requestId !== categoryNavigationRequestId) return;
			activeCategory = previousCategory;
			navigationError = 'Could not update the settings URL.';
		}
	};

	$effect(() => {
		const raw = page.url.searchParams.get('settings');
		const category = settingsCategoryFromParam(raw);
		if (!category || raw === lastSettingsUrlParam) return;
		activeCategory = category;
		open = true;
		lastSettingsUrlParam = raw;
	});

	$effect(() => {
		if (open || !lastSettingsUrlParam) return;
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.delete('settings');
		lastSettingsUrlParam = null;
		void goto(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	});

	const switchProfile = async (profile: Profile) => {
		switchingProfileId = profile.profileId;
		profileError = null;
		try {
			await switchActiveProfile(database, profile.profileId);
		} catch {
			profileError =
				profile.lockPolicy === 'pin'
					? 'Open this locked profile from the sidebar and enter its PIN.'
					: 'This profile could not be opened.';
		} finally {
			switchingProfileId = null;
		}
	};

	const savePin = async () => {
		if (!view.activeProfile) return;
		securityBusy = true;
		securityMessage = null;
		securityError = null;
		try {
			await setProfilePin(database, view.activeProfile.profileId, pin);
			pin = '';
			securityMessage = 'Profile PIN saved.';
		} catch {
			securityError = 'Use four to eight numbers for the profile PIN.';
		} finally {
			securityBusy = false;
		}
	};

	const removePin = async () => {
		if (!view.activeProfile) return;
		securityBusy = true;
		securityMessage = null;
		securityError = null;
		try {
			await clearProfilePin(database, view.activeProfile.profileId);
			pin = '';
			securityMessage = 'Profile PIN removed.';
		} catch {
			securityError = 'The profile PIN could not be removed.';
		} finally {
			securityBusy = false;
		}
	};

	const lockActiveProfile = async () => {
		if (!view.activeProfile) return;
		await lockProfile(database, view.activeProfile.profileId);
		open = false;
	};

	const loadMcpKeys = async (force = false) => {
		if (!view.activeProfile || !view.mcpPaidAccess || mcpKeysBusy || (mcpKeysLoaded && !force))
			return;
		mcpKeysBusy = true;
		mcpError = null;
		try {
			mcpKeys = await listMcpKeys(database, view.activeProfile.profileId);
			mcpKeysLoaded = true;
		} catch (cause) {
			mcpError = cause instanceof Error ? cause.message : 'Could not load MCP keys.';
		} finally {
			mcpKeysBusy = false;
		}
	};

	$effect(() => {
		if (open && activeCategory === 'mcp' && view.mcpPaidAccess) void loadMcpKeys();
	});

	const setMcpPreset = (preset: 'custom' | McpKeyPreset) => {
		mcpKeyPreset = preset;
		if (preset !== 'custom') mcpScopeLevels = scopeLevelsForScopes(scopesForPreset(preset));
	};

	const setMcpScopeRead = (groupId: McpScopeGroupId, checked: boolean) => {
		mcpKeyPreset = 'custom';
		mcpScopeLevels = setMcpScopeReadLevel(mcpScopeLevels, groupId, checked);
	};

	const setMcpScopeWrite = (groupId: McpScopeGroupId, checked: boolean) => {
		mcpKeyPreset = 'custom';
		mcpScopeLevels = setMcpScopeWriteLevel(mcpScopeLevels, groupId, checked);
	};

	const toggleMcpHousehold = (householdId: string, checked: boolean) => {
		mcpKeyHouseholdIds = toggleMcpHouseholdId(mcpKeyHouseholdIds, householdId, checked);
	};

	const createMcpAccessKey = async () => {
		if (!view.activeProfile) return;
		mcpKeyCreating = true;
		mcpMessage = null;
		mcpError = null;
		createdMcpKey = null;
		try {
			const created = await createMcpKey(database, view.activeProfile.profileId, {
				label: mcpKeyLabel.trim(),
				...(mcpKeyPreset === 'custom' ? {} : { preset: mcpKeyPreset }),
				scopes: selectedMcpScopes,
				householdScope:
					mcpKeyHouseholdKind === 'all'
						? { kind: 'all' }
						: { kind: 'households', householdIds: mcpKeyHouseholdIds }
			});
			createdMcpKey = created.key;
			mcpKeys = [created.record, ...mcpKeys];
			mcpKeyLabel = '';
			mcpKeyFormOpen = false;
			mcpMessage = 'MCP key created. Copy it now. It will not be shown again.';
		} catch (cause) {
			mcpError = cause instanceof Error ? cause.message : 'Could not create MCP key.';
		} finally {
			mcpKeyCreating = false;
		}
	};

	const rerollMcpAccessKey = async (key: McpKey) => {
		if (!view.activeProfile) return;
		rerollingMcpKeyId = key.id;
		mcpError = null;
		mcpMessage = null;
		createdMcpKey = null;
		try {
			const rerolled = await rerollMcpKey(database, view.activeProfile.profileId, key.id);
			createdMcpKey = rerolled.key;
			mcpKeys = [
				rerolled.record,
				...mcpKeys.map((candidate) =>
					candidate.id === key.id
						? { ...candidate, revokedAt: rerolled.record.createdAt }
						: candidate
				)
			];
			mcpMessage = 'MCP key rerolled. Copy the new key now. It will not be shown again.';
		} catch (cause) {
			mcpError = cause instanceof Error ? cause.message : 'Could not reroll MCP key.';
		} finally {
			rerollingMcpKeyId = null;
		}
	};

	const copyCreatedMcpKey = async () => {
		if (!createdMcpKey) return;
		try {
			await navigator.clipboard.writeText(createdMcpKey);
			mcpMessage = 'Copied MCP key.';
		} catch {
			mcpError = 'Could not copy the MCP key. Select and copy it manually.';
		}
	};

	const confirmRevokeMcpKey = (key: McpKey) => {
		mcpKeyToRevoke = key;
		mcpRevokeOpen = true;
	};

	const revokeMcpAccessKey = async () => {
		if (!view.activeProfile || !mcpKeyToRevoke) return;
		const keyId = mcpKeyToRevoke.id;
		revokingMcpKeyId = keyId;
		mcpError = null;
		try {
			await revokeMcpKey(database, view.activeProfile.profileId, keyId);
			mcpKeys = mcpKeys.map((key) =>
				key.id === keyId ? { ...key, revokedAt: new Date().toISOString() } : key
			);
			mcpRevokeOpen = false;
			mcpKeyToRevoke = null;
			mcpMessage = 'MCP key revoked.';
		} catch (cause) {
			mcpError = cause instanceof Error ? cause.message : 'Could not revoke MCP key.';
		} finally {
			revokingMcpKeyId = null;
		}
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="max-h-[min(36rem,calc(100svh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl"
	>
		<div
			class="grid max-h-[min(36rem,calc(100svh-2rem))] min-h-[26rem] overflow-hidden md:grid-cols-[12rem_minmax(0,1fr)]"
		>
			<SettingsCategoryNav
				{activeCategory}
				{categories}
				onchoose={(category) => void chooseCategory(category)}
			/>
			<section class="min-h-0 overflow-y-auto p-4">
				<SettingsSectionHeading category={activeCategoryDetails} />
				{#if navigationError}<p class="mb-4 text-xs text-destructive">{navigationError}</p>{/if}

				{#if activeCategory === 'account'}
					<AccountSettingsSection
						profiles={view.profiles}
						activeProfileId={view.activeProfile?.profileId ?? null}
						busyProfileId={switchingProfileId}
						error={profileError}
						onswitch={switchProfile}
					/>
				{:else if activeCategory === 'security'}
					<SecuritySettingsSection
						profile={view.activeProfile}
						slot={view.activeSlot}
						bind:pin
						busy={securityBusy}
						message={securityMessage}
						error={securityError}
						{reauthHref}
						{addProfileHref}
						onsavepin={savePin}
						onremovepin={removePin}
						onlock={lockActiveProfile}
					/>
				{:else if activeCategory === 'mcp'}
					{#if view.mcpPaidAccess}
						<McpSettingsSection
							{mcpServerUrl}
							{mcpKeys}
							{mcpKeysBusy}
							{rerollingMcpKeyId}
							{revokingMcpKeyId}
							{createdMcpKey}
							bind:mcpKeyFormOpen
							bind:mcpKeyLabel
							bind:mcpKeyPreset
							bind:mcpKeyHouseholdKind
							bind:mcpHouseholdPickerOpen
							bind:mcpHouseholdQuery
							{mcpKeyCreating}
							{selectedMcpScopes}
							{mcpKeyHouseholdIds}
							{mcpScopeLevels}
							{mcpHouseholdPickerLabel}
							{filteredMcpHouseholds}
							{mcpMessage}
							{mcpError}
							{loadMcpKeys}
							{rerollMcpAccessKey}
							{confirmRevokeMcpKey}
							{copyCreatedMcpKey}
							{setMcpScopeRead}
							{setMcpScopeWrite}
							{setMcpPreset}
							{toggleMcpHousehold}
							{createMcpAccessKey}
						/>
					{:else}
						<div class="grid max-w-lg gap-3 text-sm">
							<p class="text-xs text-muted-foreground">
								MCP needs an active Maal plan on at least one household. Free local meal planning
								stays available.
							</p>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a class="w-fit text-xs font-medium underline underline-offset-4" href="/subscribe"
								>See Maal plans</a
							>
						</div>
					{/if}
				{:else if activeCategory === 'billing'}
					{#if view.activeProfile && view.activeHousehold}
						<BillingSettingsSection
							{database}
							profileId={view.activeProfile.profileId}
							householdId={view.activeHousehold.householdId}
							householdName={view.activeHousehold.name}
							workosUserId={view.activeProfile.workosUserId}
							localOnly={view.activeHousehold.localOnly}
							transferCandidates={view.transferCandidates}
						/>
					{:else}
						<p class="text-xs text-muted-foreground">Choose a local profile and household first.</p>
					{/if}
				{/if}
			</section>
		</div>
	</Dialog.Content>
</Dialog.Root>

<DeleteConfirmDialog
	bind:open={mcpRevokeOpen}
	title="Revoke MCP key?"
	description={mcpKeyToRevoke
		? `Clients using “${mcpKeyToRevoke.label}” will lose access immediately.`
		: 'Clients using this MCP key will lose access immediately.'}
	confirmLabel="Revoke key"
	confirmingLabel="Revoking…"
	cancelLabel="Keep key"
	busy={Boolean(revokingMcpKeyId)}
	error={mcpError}
	onconfirm={revokeMcpAccessKey}
/>

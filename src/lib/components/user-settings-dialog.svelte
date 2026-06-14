<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { Button } from '$lib/components/ui/button';
	import DeleteConfirmDialog from '$lib/components/delete-confirm-dialog.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Command from '$lib/components/ui/command';
	import * as Dialog from '$lib/components/ui/dialog';
	import AccountSettingsSection from '$lib/components/settings/account-settings-section.svelte';
	import BillingSettingsSection from '$lib/components/settings/billing-settings-section.svelte';
	import McpCreatedKeyPanel from '$lib/components/settings/mcp-created-key-panel.svelte';
	import McpKeyListItem from '$lib/components/settings/mcp-key-list-item.svelte';
	import MfaSetupDialog from '$lib/components/settings/mfa-setup-dialog.svelte';
	import NotificationsSettingsSection from '$lib/components/settings/notifications-settings-section.svelte';
	import PasswordChangeDialog from '$lib/components/settings/password-change-dialog.svelte';
	import SecuritySettingsSection from '$lib/components/settings/security-settings-section.svelte';
	import SettingsCategoryNav from '$lib/components/settings/settings-category-nav.svelte';
	import SettingsSectionHeading from '$lib/components/settings/settings-section-heading.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import {
		filterMcpHouseholds,
		mcpHouseholdPickerLabel as formatMcpHouseholdPickerLabel,
		mcpScopeGroups,
		selectedMcpHouseholds as selectMcpHouseholds,
		selectedMcpScopesForLevels,
		setMcpScopeReadLevel,
		setMcpScopeWriteLevel,
		toggleMcpHouseholdId,
		type McpKey,
		type McpScope,
		type McpScopeLevel
	} from '$lib/settings/mcp-key-model';
	import {
		accountEmailChanged as hasAccountEmailChanged,
		accountEmailVerified as isAccountEmailVerified,
		emailVerificationRequired as needsEmailVerification,
		normalizedEmail,
		verificationAttemptKey
	} from '$lib/settings/account-model';
	import { readSettingsError } from '$lib/settings/api-client';
	import { emptyPasswordChangeFields, passwordChangeMismatch } from '$lib/settings/password-model';
	import type {
		BillingStatus,
		MfaFactor,
		SettingsCategoryId,
		SettingsHousehold,
		UpdatedUser,
		User
	} from '$lib/settings/types';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import {
		settingsCategories,
		settingsCategoryFromParam,
		type SettingsCategory
	} from '$lib/settings/categories';

	let {
		open = $bindable(false),
		user,
		onuserupdate
	}: { open?: boolean; user: User; onuserupdate?: (user: UpdatedUser) => void } = $props();

	let activeCategory = $state<SettingsCategoryId>('account');
	let accountName = $derived(user.name);
	let accountEmail = $derived(user.email);
	let verifiedEmail = $derived<string | null>(user.emailVerified ? user.email.toLowerCase() : null);
	let verificationEmail = $state<string | null>(null);
	let lastVerificationAttempt = $state('');
	let accountSaving = $state(false);
	let accountMessage = $state<string | null>(null);
	let accountError = $state<string | null>(null);
	let emailVerificationCode = $state('');
	let emailVerificationBusy = $state(false);
	let emailVerificationChecking = $state(false);
	let passwordChangeOpen = $state(false);
	let passwordChangeBusy = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordMessage = $state<string | null>(null);
	let passwordError = $state<string | null>(null);
	let mfaSetupOpen = $state(false);
	let mfaSetupBusy = $state(false);
	let mfaVerifyBusy = $state(false);
	let mfaCode = $state('');
	let mfaSetup = $state<{
		factorId: string;
		challengeId: string;
		qrCode: string;
		secret: string;
	} | null>(null);
	let mfaFactors = $state<MfaFactor[]>([]);
	let mfaFactorsLoaded = $state(false);
	let mfaFactorsBusy = $state(false);
	let deletingMfaFactorId = $state<string | null>(null);
	let mfaDeleteOpen = $state(false);
	let mfaFactorToDelete = $state<MfaFactor | null>(null);
	let securityMessage = $state<string | null>(null);
	let securityError = $state<string | null>(null);
	let mcpKeys = $state<McpKey[]>([]);
	let mcpHouseholds = $state<SettingsHousehold[]>([]);
	let mcpKeysLoaded = $state(false);
	let mcpKeysBusy = $state(false);
	let mcpKeyCreating = $state(false);
	let mcpKeyFormOpen = $state(false);
	let mcpKeyLabel = $state('');
	let mcpScopeLevels = $state<Record<string, McpScopeLevel>>({
		households: 'read',
		recipes: 'read',
		meals: 'read',
		checkIns: 'none',
		foodProfile: 'none'
	});
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
	let billingStatus = $state<BillingStatus | null>(null);
	let billingBusy = $state(false);
	let billingPortalBusy = $state(false);
	let billingError = $state<string | null>(null);

	const verificationCodeMinLength = 6;
	const normalizedAccountEmail = $derived(normalizedEmail(accountEmail));
	const currentAccountEmail = $derived(normalizedEmail(user.email));
	const accountEmailChanged = $derived(hasAccountEmailChanged(accountEmail, user.email));
	const accountEmailVerified = $derived(isAccountEmailVerified(accountEmail, verifiedEmail));
	const emailVerificationRequired = $derived(
		needsEmailVerification(accountEmail, user.email, verifiedEmail)
	);
	const accountCanSave = $derived(!accountSaving && !emailVerificationRequired);

	const categories: SettingsCategory[] = settingsCategories;

	const activeCategoryDetails = $derived(
		categories.find((category) => category.id === activeCategory) ?? categories[0]
	);

	let lastSettingsUrlParam = $state<string | null>(null);

	const settingsCategoryFromUrl = (): SettingsCategoryId | null =>
		settingsCategoryFromParam(page.url.searchParams.get('settings'));

	const chooseCategory = async (category: SettingsCategory) => {
		if (category.disabled) return;
		activeCategory = category.id;
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.set('settings', category.id);
		lastSettingsUrlParam = category.id;
		await goto(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	};

	$effect(() => {
		const category = settingsCategoryFromUrl();
		const settingsParam = page.url.searchParams.get('settings');
		if (!category || settingsParam === lastSettingsUrlParam) return;
		activeCategory = category;
		open = true;
		lastSettingsUrlParam = settingsParam;
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

	$effect(() => {
		const email = normalizedAccountEmail;
		if (verificationEmail === email) return;
		emailVerificationCode = '';
		lastVerificationAttempt = '';
		accountMessage = null;
		accountError = null;
	});

	const saveAccount = async (event: SubmitEvent) => {
		event.preventDefault();
		if (emailVerificationRequired) return;
		accountSaving = true;
		accountMessage = null;
		accountError = null;

		const response = await fetch(resolve('/settings/account'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: accountName, email: accountEmail })
		});

		accountSaving = false;
		if (!response.ok) {
			accountError = await readSettingsError(response, 'Could not update account.');
			return;
		}

		const body = (await response.json()) as { user: UpdatedUser; pendingEmail?: string };
		onuserupdate?.(body.user);
		accountName = body.user.name ?? body.user.email;
		accountEmail = body.pendingEmail ?? body.user.email;
		verifiedEmail = body.user.emailVerified ? body.user.email.toLowerCase() : null;
		verificationEmail = body.pendingEmail ?? null;
		emailVerificationCode = '';
		lastVerificationAttempt = '';
		accountMessage = body.pendingEmail ? 'Verification code sent.' : 'Saved.';
	};

	const sendVerificationEmail = async () => {
		if (!normalizedAccountEmail) return;
		emailVerificationBusy = true;
		accountMessage = null;
		accountError = null;

		const response = await fetch(resolve('/settings/account/email-verification'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: normalizedAccountEmail })
		});

		emailVerificationBusy = false;
		if (!response.ok) {
			accountError = await readSettingsError(response, 'Could not send verification email.');
			return;
		}
		verificationEmail = normalizedAccountEmail;
		emailVerificationCode = '';
		lastVerificationAttempt = '';
		accountMessage = 'Verification code sent.';
	};

	const verifyEmailCode = async (email: string, code: string) => {
		const attemptKey = verificationAttemptKey(email, code);
		lastVerificationAttempt = attemptKey;
		emailVerificationChecking = true;
		accountMessage = null;
		accountError = null;

		const response = await fetch(resolve('/settings/account/email-verification'), {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, code })
		});

		emailVerificationChecking = false;
		if (!response.ok) {
			accountError = await readSettingsError(response, 'That code did not match.');
			return;
		}

		const body = (await response.json()) as { user: UpdatedUser };
		onuserupdate?.(body.user);
		accountName = body.user.name ?? body.user.email;
		accountEmail = body.user.email;
		verifiedEmail = body.user.emailVerified ? body.user.email.toLowerCase() : email;
		verificationEmail = null;
		emailVerificationCode = '';
		accountMessage = 'Email changed.';
	};

	$effect(() => {
		const email = normalizedAccountEmail;
		const code = emailVerificationCode.trim();
		if (
			!emailVerificationRequired ||
			verificationEmail !== email ||
			code.length < verificationCodeMinLength ||
			lastVerificationAttempt === verificationAttemptKey(email, code)
		) {
			return;
		}

		const timeout = setTimeout(() => void verifyEmailCode(email, code), 300);
		return () => clearTimeout(timeout);
	});

	const loadMfaFactors = async (force = false) => {
		if (mfaFactorsBusy || (mfaFactorsLoaded && !force)) return;
		mfaFactorsBusy = true;
		securityError = null;

		const response = await fetch(resolve('/settings/security/mfa'));
		mfaFactorsBusy = false;
		if (!response.ok) {
			securityError = await readSettingsError(response, 'Could not load two-factor methods.');
			return;
		}

		const body = (await response.json()) as { factors: MfaFactor[] };
		mfaFactors = body.factors;
		mfaFactorsLoaded = true;
	};

	$effect(() => {
		if (open && activeCategory === 'security') void loadMfaFactors();
	});

	const selectedMcpScopes = $derived(selectedMcpScopesForLevels(mcpScopeLevels));
	const selectedMcpHouseholds = $derived(selectMcpHouseholds(mcpHouseholds, mcpKeyHouseholdIds));
	const mcpHouseholdPickerLabel = $derived(formatMcpHouseholdPickerLabel(selectedMcpHouseholds));
	const filteredMcpHouseholds = $derived(filterMcpHouseholds(mcpHouseholds, mcpHouseholdQuery));

	const loadMcpKeys = async (force = false) => {
		if (mcpKeysBusy || (mcpKeysLoaded && !force)) return;
		mcpKeysBusy = true;
		mcpError = null;
		const response = await fetch(resolve('/settings/mcp-keys'));
		mcpKeysBusy = false;
		if (!response.ok) {
			mcpError = await readSettingsError(response, 'Could not load MCP keys.');
			return;
		}
		const body = (await response.json()) as { keys: McpKey[]; households: SettingsHousehold[] };
		mcpKeys = body.keys;
		mcpHouseholds = body.households;
		mcpKeyHouseholdIds = mcpKeyHouseholdIds.length
			? mcpKeyHouseholdIds
			: body.households[0]
				? [body.households[0].id]
				: [];
		mcpKeysLoaded = true;
	};

	$effect(() => {
		if (open && activeCategory === 'mcp') void loadMcpKeys();
	});

	const toggleMcpHousehold = (householdId: string, checked: boolean) => {
		mcpKeyHouseholdIds = toggleMcpHouseholdId(mcpKeyHouseholdIds, householdId, checked);
	};

	const setMcpScopeRead = (groupId: string, checked: boolean) => {
		mcpScopeLevels = setMcpScopeReadLevel(mcpScopeLevels, groupId, checked);
	};

	const setMcpScopeWrite = (groupId: string, checked: boolean) => {
		mcpScopeLevels = setMcpScopeWriteLevel(mcpScopeLevels, groupId, checked);
	};

	const createMcpAccessKey = async () => {
		mcpKeyCreating = true;
		mcpMessage = null;
		mcpError = null;
		createdMcpKey = null;
		const response = await fetch(resolve('/settings/mcp-keys'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				label: mcpKeyLabel,
				scopes: selectedMcpScopes,
				householdScope:
					mcpKeyHouseholdKind === 'all'
						? { kind: 'all' }
						: { kind: 'households', householdIds: mcpKeyHouseholdIds }
			})
		});
		mcpKeyCreating = false;
		if (!response.ok) {
			mcpError = await readSettingsError(response, 'Could not create MCP key.');
			return;
		}
		const body = (await response.json()) as { key: string; record: McpKey };
		createdMcpKey = body.key;
		mcpKeys = [body.record, ...mcpKeys];
		mcpKeyLabel = '';
		mcpKeyFormOpen = false;
		mcpMessage = 'MCP key created. Copy it now — it will not be shown again.';
	};

	const rerollMcpAccessKey = async (key: McpKey) => {
		rerollingMcpKeyId = key.id;
		mcpError = null;
		mcpMessage = null;
		createdMcpKey = null;
		const response = await fetch(resolve('/settings/mcp-keys'), {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ keyId: key.id })
		});
		rerollingMcpKeyId = null;
		if (!response.ok) {
			mcpError = await readSettingsError(response, 'Could not reroll MCP key.');
			return;
		}
		const body = (await response.json()) as { key: string; record: McpKey };
		createdMcpKey = body.key;
		mcpKeys = mcpKeys.map((existingKey) =>
			existingKey.id === body.record.id ? body.record : existingKey
		);
		mcpMessage = 'MCP key rerolled. Copy the new key now — it will not be shown again.';
	};

	const copyCreatedMcpKey = async () => {
		if (!createdMcpKey) return;
		try {
			await navigator.clipboard.writeText(createdMcpKey);
			mcpMessage = 'Copied MCP key.';
		} catch {
			mcpError = 'Could not copy MCP key. Select and copy it manually.';
		}
	};

	const revokeMcpAccessKey = async () => {
		if (!mcpKeyToRevoke) return;
		revokingMcpKeyId = mcpKeyToRevoke.id;
		mcpError = null;
		mcpMessage = null;
		const response = await fetch(resolve('/settings/mcp-keys'), {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ keyId: mcpKeyToRevoke.id })
		});
		revokingMcpKeyId = null;
		if (!response.ok) {
			mcpError = await readSettingsError(response, 'Could not revoke MCP key.');
			return;
		}
		mcpKeys = mcpKeys.map((key) =>
			key.id === mcpKeyToRevoke?.id ? { ...key, revokedAt: new Date().toISOString() } : key
		);
		mcpRevokeOpen = false;
		mcpKeyToRevoke = null;
		mcpMessage = 'MCP key revoked.';
	};

	const confirmRevokeMcpKey = (key: McpKey) => {
		mcpKeyToRevoke = key;
		mcpRevokeOpen = true;
	};

	$effect(() => {
		if (mcpRevokeOpen || revokingMcpKeyId) return;
		mcpKeyToRevoke = null;
	});

	const loadBillingStatus = async () => {
		if (billingBusy) return;
		billingBusy = true;
		billingError = null;
		const response = await fetch(resolve('/billing/status'));
		billingBusy = false;
		if (!response.ok) {
			billingError = await readSettingsError(response, 'Could not load billing.');
			return;
		}
		billingStatus = (await response.json()) as BillingStatus;
	};

	$effect(() => {
		if (open && activeCategory === 'billing') void loadBillingStatus();
	});

	const openBillingPortal = async (householdId = billingStatus?.householdId) => {
		if (!householdId) return;
		billingPortalBusy = true;
		billingError = null;
		const response = await fetch(resolve('/billing/portal'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ householdId })
		});
		billingPortalBusy = false;
		if (!response.ok) {
			billingError = await readSettingsError(response, 'Could not open billing portal.');
			return;
		}
		const body = (await response.json()) as { url?: string };
		if (body.url) window.open(body.url, '_blank', 'noopener,noreferrer');
	};

	const startMfaSetup = async () => {
		mfaSetupBusy = true;
		securityMessage = null;
		securityError = null;

		const response = await fetch(resolve('/settings/security/mfa'), {
			method: 'POST'
		});

		mfaSetupBusy = false;
		if (!response.ok) {
			securityError = await readSettingsError(response, 'Could not start two-factor setup.');
			return;
		}

		const body = (await response.json()) as {
			factorId: string;
			challengeId: string;
			qrCode: string;
			secret: string;
		};
		mfaSetup = body;
		mfaCode = '';
		mfaSetupOpen = true;
	};

	const verifyMfaSetup = async () => {
		if (!mfaSetup || mfaCode.trim().length < verificationCodeMinLength) return;
		mfaVerifyBusy = true;
		securityMessage = null;
		securityError = null;

		const response = await fetch(resolve('/settings/security/mfa'), {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				factorId: mfaSetup.factorId,
				challengeId: mfaSetup.challengeId,
				code: mfaCode
			})
		});

		mfaVerifyBusy = false;
		if (!response.ok) {
			securityError = await readSettingsError(response, 'That code did not match.');
			return;
		}

		const body = (await response.json()) as { factors?: MfaFactor[] };
		mfaFactors = body.factors ?? mfaFactors;
		mfaFactorsLoaded = true;
		mfaSetupOpen = false;
		mfaSetup = null;
		mfaCode = '';
		securityMessage = 'Two-factor authentication is set up.';
	};

	const deleteMfaFactor = async () => {
		const factor = mfaFactorToDelete;
		if (!factor) return;
		deletingMfaFactorId = factor.id;
		securityMessage = null;
		securityError = null;

		const response = await fetch(resolve('/settings/security/mfa'), {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ factorId: factor.id })
		});

		deletingMfaFactorId = null;
		if (!response.ok) {
			securityError = await readSettingsError(response, 'Could not remove two-factor method.');
			return;
		}

		const body = (await response.json()) as { factors: MfaFactor[] };
		mfaFactors = body.factors;
		mfaDeleteOpen = false;
		mfaFactorToDelete = null;
		securityMessage = 'Authenticator app removed.';
	};

	const confirmDeleteMfaFactor = (factor: MfaFactor) => {
		mfaFactorToDelete = factor;
		mfaDeleteOpen = true;
	};

	$effect(() => {
		if (mfaDeleteOpen || deletingMfaFactorId) return;
		mfaFactorToDelete = null;
	});

	const openPasswordChange = () => {
		({ currentPassword, newPassword, confirmPassword } = emptyPasswordChangeFields());
		passwordMessage = null;
		passwordError = null;
		passwordChangeOpen = true;
	};

	const changePassword = async () => {
		passwordMessage = null;
		passwordError = null;
		const mismatch = passwordChangeMismatch(newPassword, confirmPassword);
		if (mismatch) {
			passwordError = mismatch;
			return;
		}

		passwordChangeBusy = true;
		const response = await fetch(resolve('/settings/security/password'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ currentPassword, newPassword })
		});

		passwordChangeBusy = false;
		if (!response.ok) {
			passwordError = await readSettingsError(response, 'Could not change password.');
			return;
		}

		passwordChangeOpen = false;
		securityMessage = 'Password changed.';
	};
</script>

<svelte:head>
	<script async src="https://js.stripe.com/v3/pricing-table.js"></script>
</svelte:head>

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

				{#if activeCategory === 'account'}
					<AccountSettingsSection
						bind:accountName
						bind:accountEmail
						bind:emailVerificationCode
						{verificationEmail}
						{normalizedAccountEmail}
						{accountEmailChanged}
						{accountEmailVerified}
						{emailVerificationRequired}
						{emailVerificationBusy}
						{emailVerificationChecking}
						{accountCanSave}
						{accountSaving}
						{accountMessage}
						{accountError}
						{saveAccount}
						{sendVerificationEmail}
					/>
				{:else if activeCategory === 'security'}
					<SecuritySettingsSection
						{mfaSetupBusy}
						{mfaFactorsBusy}
						{mfaFactors}
						{deletingMfaFactorId}
						{securityMessage}
						{securityError}
						{openPasswordChange}
						{startMfaSetup}
						{confirmDeleteMfaFactor}
					/>
				{:else if activeCategory === 'mcp'}
					<div class="grid max-w-lg gap-5 text-sm">
						<div class="grid gap-2">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="text-xs font-medium">MCP keys</p>
									<p class="text-xs text-muted-foreground">
										Use MCP keys in clients like Claude Desktop or Inspector.
									</p>
								</div>
								<Button size="sm" onclick={() => (mcpKeyFormOpen = true)}>Create MCP key</Button>
							</div>
							{#if mcpKeysBusy}
								<p class="text-xs text-muted-foreground">Loading MCP keys…</p>
							{:else if mcpKeys.length === 0}
								<p class="text-xs text-muted-foreground">No MCP keys yet.</p>
							{:else}
								<ul class="divide-y rounded-md border border-border">
									{#each mcpKeys as key (key.id)}
										<McpKeyListItem
											keyRecord={key}
											{rerollingMcpKeyId}
											{revokingMcpKeyId}
											{rerollMcpAccessKey}
											{confirmRevokeMcpKey}
										/>
									{/each}
								</ul>
							{/if}
							<div class="flex justify-end">
								<Button
									variant="ghost"
									size="sm"
									disabled={mcpKeysBusy}
									onclick={() => loadMcpKeys(true)}
								>
									Refresh
								</Button>
							</div>
						</div>
						{#if createdMcpKey}
							<McpCreatedKeyPanel {createdMcpKey} {copyCreatedMcpKey} />
						{/if}
						{#if mcpKeyFormOpen}
							<div class="grid gap-3">
								<div>
									<p class="text-xs font-medium">Create MCP key</p>
									<p class="text-xs text-muted-foreground">
										Choose permissions and household access.
									</p>
								</div>
								<label class="grid gap-1 text-xs font-medium">
									Label
									<Input bind:value={mcpKeyLabel} placeholder="Claude on my laptop" class="h-8" />
								</label>
								<div class="grid gap-2 text-xs">
									<div>
										<p class="font-medium">Permissions</p>
										<p class="text-muted-foreground">Write automatically includes read.</p>
									</div>
									<div class="grid gap-2">
										{#each mcpScopeGroups as group (group.id)}
											{@const level = mcpScopeLevels[group.id] ?? 'none'}
											<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
												<div class="min-w-0">
													<p class="font-medium">{group.label}</p>
													<p class="text-muted-foreground">{group.description}</p>
												</div>
												<div class="flex flex-wrap items-center gap-3">
													{#if group.read}
														<label class="flex items-center gap-2 px-1 py-1">
															<Checkbox
																checked={level === 'read' || level === 'write'}
																disabled={level === 'write'}
																onCheckedChange={(checked) =>
																	setMcpScopeRead(group.id, checked === true)}
															/>
															<span>Read</span>
														</label>
													{/if}
													{#if group.write}
														<label class="flex items-center gap-2 px-1 py-1">
															<Checkbox
																checked={level === 'write'}
																onCheckedChange={(checked) =>
																	setMcpScopeWrite(group.id, checked === true)}
															/>
															<span>Write</span>
														</label>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								</div>
								<div class="grid gap-2 text-xs">
									<span class="font-medium">Households</span>
									<RadioGroup.Root bind:value={mcpKeyHouseholdKind} class="gap-2">
										<label class="flex items-center gap-2 py-1"
											><RadioGroup.Item value="all" /><span>All current and future households</span
											></label
										>
										<label class="flex items-center gap-2 py-1"
											><RadioGroup.Item value="households" /><span>Selected households</span></label
										>
									</RadioGroup.Root>
									{#if mcpKeyHouseholdKind === 'households'}
										<Popover.Root bind:open={mcpHouseholdPickerOpen}>
											<Popover.Trigger>
												<Button
													type="button"
													variant="outline"
													class="h-8 w-full justify-between text-xs font-normal"
													><span class="truncate">{mcpHouseholdPickerLabel}</span
													><ChevronsUpDownIcon class="size-3.5 opacity-50" /></Button
												>
											</Popover.Trigger>
											<Popover.Content align="start" class="w-[22rem] max-w-[calc(100vw-2rem)] p-1">
												<Command.Root>
													<Command.Input
														bind:value={mcpHouseholdQuery}
														placeholder="Search households…"
													/>
													<Command.List class="max-h-56 overflow-y-auto p-1">
														{#if filteredMcpHouseholds.length === 0}<Command.Empty
																>No households found.</Command.Empty
															>{:else}
															{#each filteredMcpHouseholds as household (household.id)}
																{@const checked = mcpKeyHouseholdIds.includes(household.id)}
																<Command.Item
																	value={household.name}
																	data-checked={checked}
																	onselect={() => toggleMcpHousehold(household.id, !checked)}
																	><Checkbox {checked} class="pointer-events-none" /><span
																		class="truncate">{household.name}</span
																	></Command.Item
																>
															{/each}
														{/if}
													</Command.List>
												</Command.Root>
											</Popover.Content>
										</Popover.Root>
									{/if}
								</div>
								<div class="flex justify-end gap-2">
									<Button
										variant="ghost"
										disabled={mcpKeyCreating}
										onclick={() => (mcpKeyFormOpen = false)}>Cancel</Button
									>
									<Button
										disabled={mcpKeyCreating ||
											!mcpKeyLabel.trim() ||
											!selectedMcpScopes.length ||
											(mcpKeyHouseholdKind === 'households' && !mcpKeyHouseholdIds.length)}
										onclick={createMcpAccessKey}
										>{mcpKeyCreating ? 'Creating…' : 'Create MCP key'}</Button
									>
								</div>
							</div>
						{/if}
						{#if mcpMessage}<p class="text-xs text-muted-foreground">{mcpMessage}</p>{/if}
						{#if mcpError}<p class="text-xs text-destructive">{mcpError}</p>{/if}
					</div>
				{:else if activeCategory === 'notifications'}
					<NotificationsSettingsSection />
				{:else if activeCategory === 'billing'}
					<BillingSettingsSection
						{billingBusy}
						{billingStatus}
						{billingPortalBusy}
						{billingError}
						{openBillingPortal}
					/>
				{/if}
			</section>
		</div>
	</Dialog.Content>
</Dialog.Root>

<PasswordChangeDialog
	bind:open={passwordChangeOpen}
	bind:currentPassword
	bind:newPassword
	bind:confirmPassword
	{passwordMessage}
	{passwordError}
	{passwordChangeBusy}
	{changePassword}
/>

<DeleteConfirmDialog
	bind:open={mcpRevokeOpen}
	title="Revoke MCP key?"
	description={mcpKeyToRevoke
		? `Clients using “${mcpKeyToRevoke.label}” will lose access immediately.`
		: 'Clients using this MCP key will lose access immediately.'}
	confirmLabel="Revoke"
	confirmingLabel="Revoking…"
	cancelLabel="Keep key"
	busy={Boolean(revokingMcpKeyId)}
	error={mcpError}
	onconfirm={revokeMcpAccessKey}
/>

<DeleteConfirmDialog
	bind:open={mfaDeleteOpen}
	title="Remove authenticator app?"
	description="You will need another sign-in method to use two-factor authentication."
	confirmLabel="Remove"
	confirmingLabel="Removing…"
	cancelLabel="Keep app"
	busy={Boolean(deletingMfaFactorId)}
	error={securityError}
	onconfirm={deleteMfaFactor}
/>

<MfaSetupDialog
	bind:open={mfaSetupOpen}
	bind:mfaCode
	{mfaSetup}
	{mfaVerifyBusy}
	{verificationCodeMinLength}
	{verifyMfaSetup}
/>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DeleteConfirmDialog from '$lib/components/delete-confirm-dialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import AccountSettingsSection from '$lib/components/settings/account-settings-section.svelte';
	import BillingSettingsSection from '$lib/components/settings/billing-settings-section.svelte';
	import McpSettingsSection from '$lib/components/settings/mcp-settings-section.svelte';
	import MfaSetupDialog from '$lib/components/settings/mfa-setup-dialog.svelte';
	import NotificationsSettingsSection from '$lib/components/settings/notifications-settings-section.svelte';
	import PasswordChangeDialog from '$lib/components/settings/password-change-dialog.svelte';
	import SecuritySettingsSection from '$lib/components/settings/security-settings-section.svelte';
	import SettingsCategoryNav from '$lib/components/settings/settings-category-nav.svelte';
	import SettingsSectionHeading from '$lib/components/settings/settings-section-heading.svelte';
	import {
		filterMcpHouseholds,
		mcpHouseholdPickerLabel as formatMcpHouseholdPickerLabel,
		selectedMcpHouseholds as selectMcpHouseholds,
		selectedMcpScopesForLevels,
		setMcpScopeReadLevel,
		setMcpScopeWriteLevel,
		toggleMcpHouseholdId,
		type McpKey,
		type McpScopeGroupId,
		type McpScopeLevels
	} from '$lib/settings/mcp-key-model';
	import {
		accountEmailChanged as hasAccountEmailChanged,
		accountEmailVerified as isAccountEmailVerified,
		emailVerificationRequired as needsEmailVerification,
		normalizedEmail,
		verificationAttemptKey
	} from '$lib/settings/account-model';
	import {
		changePasswordRequest,
		deleteMfaFactorRequest,
		loadMfaFactors as requestMfaFactors,
		startMfaSetupRequest,
		verifyMfaSetupRequest
	} from '$lib/settings/security-client';
	import {
		createMcpKey,
		loadMcpKeys as requestMcpKeys,
		rerollMcpKey,
		revokeMcpKey
	} from '$lib/settings/mcp-key-client';
	import {
		createBillingPortalSession,
		loadBillingStatus as requestBillingStatus
	} from '$lib/settings/billing-client';
	import {
		saveAccountSettings,
		sendAccountVerificationEmail,
		verifyAccountEmailCode
	} from '$lib/settings/account-client';
	import { emptyPasswordChangeFields, passwordChangeMismatch } from '$lib/settings/password-model';
	import type {
		BillingStatus,
		MfaFactor,
		SettingsCategoryId,
		SettingsHousehold,
		UpdatedUser,
		User
	} from '$lib/settings/types';
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
	let mcpScopeLevels = $state<McpScopeLevels>({
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
	const accountEmailChanged = $derived(hasAccountEmailChanged(accountEmail, user.email));
	const accountEmailVerified = $derived(isAccountEmailVerified(accountEmail, verifiedEmail));
	const emailVerificationRequired = $derived(
		needsEmailVerification(accountEmail, user.email, verifiedEmail)
	);
	const accountCanSave = $derived(!accountSaving && !emailVerificationRequired);
	const mcpServerUrl = $derived(`${page.url.origin}/mcp`);

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
		try {
			await goto(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, {
				keepFocus: true,
				noScroll: true,
				replaceState: true
			});
		} catch {
			accountError = 'Could not update the settings URL.';
		}
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

		try {
			const body = await saveAccountSettings({ name: accountName, email: accountEmail });
			if (!body.ok) {
				accountError = body.error;
				return;
			}
			onuserupdate?.(body.user);
			accountName = body.user.name ?? body.user.email;
			accountEmail = body.pendingEmail ?? body.user.email;
			verifiedEmail = body.user.emailVerified ? body.user.email.toLowerCase() : null;
			verificationEmail = body.pendingEmail ?? null;
			emailVerificationCode = '';
			lastVerificationAttempt = '';
			accountMessage = body.pendingEmail ? 'Verification code sent.' : 'Saved.';
		} catch {
			accountError = 'Could not save account settings.';
		} finally {
			accountSaving = false;
		}
	};

	const sendVerificationEmail = async () => {
		if (!normalizedAccountEmail) return;
		emailVerificationBusy = true;
		accountMessage = null;
		accountError = null;

		try {
			const result = await sendAccountVerificationEmail(normalizedAccountEmail);
			if (!result.ok) {
				accountError = result.error;
				return;
			}
			verificationEmail = normalizedAccountEmail;
			emailVerificationCode = '';
			lastVerificationAttempt = '';
			accountMessage = 'Verification code sent.';
		} catch {
			accountError = 'Could not send a verification code.';
		} finally {
			emailVerificationBusy = false;
		}
	};

	const verifyEmailCode = async (email: string, code: string) => {
		const attemptKey = verificationAttemptKey(email, code);
		lastVerificationAttempt = attemptKey;
		emailVerificationChecking = true;
		accountMessage = null;
		accountError = null;

		try {
			const body = await verifyAccountEmailCode({ email, code });
			if (!body.ok) {
				accountError = body.error;
				return;
			}
			onuserupdate?.(body.user);
			accountName = body.user.name ?? body.user.email;
			accountEmail = body.user.email;
			verifiedEmail = body.user.emailVerified ? body.user.email.toLowerCase() : email;
			verificationEmail = null;
			emailVerificationCode = '';
			accountMessage = 'Email changed.';
		} catch {
			accountError = 'Could not verify that code.';
		} finally {
			emailVerificationChecking = false;
		}
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

		try {
			const result = await requestMfaFactors();
			if (!result.ok) {
				securityError = result.error;
				return;
			}

			mfaFactors = result.factors;
			mfaFactorsLoaded = true;
		} catch {
			securityError = 'Could not load authentication factors.';
		} finally {
			mfaFactorsBusy = false;
		}
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
		try {
			const body = await requestMcpKeys();
			if (!body.ok) {
				mcpError = body.error;
				return;
			}
			mcpKeys = body.keys;
			mcpHouseholds = body.households;
			mcpKeyHouseholdIds = mcpKeyHouseholdIds.length
				? mcpKeyHouseholdIds
				: body.households[0]
					? [body.households[0].id]
					: [];
			mcpKeysLoaded = true;
		} catch {
			mcpError = 'Could not load MCP keys.';
		} finally {
			mcpKeysBusy = false;
		}
	};

	$effect(() => {
		if (open && activeCategory === 'mcp') void loadMcpKeys();
	});

	const toggleMcpHousehold = (householdId: string, checked: boolean) => {
		mcpKeyHouseholdIds = toggleMcpHouseholdId(mcpKeyHouseholdIds, householdId, checked);
	};

	const setMcpScopeRead = (groupId: McpScopeGroupId, checked: boolean) => {
		mcpScopeLevels = setMcpScopeReadLevel(mcpScopeLevels, groupId, checked);
	};

	const setMcpScopeWrite = (groupId: McpScopeGroupId, checked: boolean) => {
		mcpScopeLevels = setMcpScopeWriteLevel(mcpScopeLevels, groupId, checked);
	};

	const createMcpAccessKey = async () => {
		mcpKeyCreating = true;
		mcpMessage = null;
		mcpError = null;
		createdMcpKey = null;
		try {
			const body = await createMcpKey({
				label: mcpKeyLabel,
				scopes: selectedMcpScopes,
				householdScope:
					mcpKeyHouseholdKind === 'all'
						? { kind: 'all' }
						: { kind: 'households', householdIds: mcpKeyHouseholdIds }
			});
			if (!body.ok) {
				mcpError = body.error;
				return;
			}
			createdMcpKey = body.key;
			mcpKeys = [body.record, ...mcpKeys];
			mcpKeyLabel = '';
			mcpKeyFormOpen = false;
			mcpMessage = 'MCP key created. Copy it now — it will not be shown again.';
		} catch {
			mcpError = 'Could not create MCP key.';
		} finally {
			mcpKeyCreating = false;
		}
	};

	const rerollMcpAccessKey = async (key: McpKey) => {
		rerollingMcpKeyId = key.id;
		mcpError = null;
		mcpMessage = null;
		createdMcpKey = null;
		try {
			const body = await rerollMcpKey(key.id);
			if (!body.ok) {
				mcpError = body.error;
				return;
			}
			createdMcpKey = body.key;
			mcpKeys = mcpKeys.map((existingKey) =>
				existingKey.id === body.record.id ? body.record : existingKey
			);
			mcpMessage = 'MCP key rerolled. Copy the new key now — it will not be shown again.';
		} catch {
			mcpError = 'Could not reroll MCP key.';
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
			mcpError = 'Could not copy MCP key. Select and copy it manually.';
		}
	};

	const revokeMcpAccessKey = async () => {
		if (!mcpKeyToRevoke) return;
		const keyId = mcpKeyToRevoke.id;
		revokingMcpKeyId = keyId;
		mcpError = null;
		mcpMessage = null;
		try {
			const result = await revokeMcpKey(keyId);
			if (!result.ok) {
				mcpError = result.error;
				return;
			}
			mcpKeys = mcpKeys.map((key) =>
				key.id === keyId ? { ...key, revokedAt: new Date().toISOString() } : key
			);
			mcpRevokeOpen = false;
			mcpKeyToRevoke = null;
			mcpMessage = 'MCP key revoked.';
		} catch {
			mcpError = 'Could not revoke MCP key.';
		} finally {
			revokingMcpKeyId = null;
		}
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
		try {
			const result = await requestBillingStatus();
			if (!result.ok) {
				billingError = result.error;
				return;
			}
			billingStatus = result.status;
		} catch {
			billingError = 'Could not load billing status.';
		} finally {
			billingBusy = false;
		}
	};

	$effect(() => {
		if (open && activeCategory === 'billing') void loadBillingStatus();
	});

	const openBillingPortal = async (householdId = billingStatus?.householdId) => {
		if (!householdId) return;
		billingPortalBusy = true;
		billingError = null;
		try {
			const result = await createBillingPortalSession(householdId);
			if (!result.ok) {
				billingError = result.error;
				return;
			}
			if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer');
		} catch {
			billingError = 'Could not open the billing portal.';
		} finally {
			billingPortalBusy = false;
		}
	};

	const startMfaSetup = async () => {
		mfaSetupBusy = true;
		securityMessage = null;
		securityError = null;

		try {
			const result = await startMfaSetupRequest();
			if (!result.ok) {
				securityError = result.error;
				return;
			}

			mfaSetup = result.setup;
			mfaCode = '';
			mfaSetupOpen = true;
		} catch {
			securityError = 'Could not start two-factor setup.';
		} finally {
			mfaSetupBusy = false;
		}
	};

	const verifyMfaSetup = async () => {
		if (!mfaSetup || mfaCode.trim().length < verificationCodeMinLength) return;
		mfaVerifyBusy = true;
		securityMessage = null;
		securityError = null;

		try {
			const result = await verifyMfaSetupRequest({
				factorId: mfaSetup.factorId,
				challengeId: mfaSetup.challengeId,
				code: mfaCode
			});
			if (!result.ok) {
				securityError = result.error;
				return;
			}

			mfaFactors = result.factors ?? mfaFactors;
			mfaFactorsLoaded = true;
			mfaSetupOpen = false;
			mfaSetup = null;
			mfaCode = '';
			securityMessage = 'Two-factor authentication is set up.';
		} catch {
			securityError = 'Could not verify that authenticator code.';
		} finally {
			mfaVerifyBusy = false;
		}
	};

	const deleteMfaFactor = async () => {
		const factor = mfaFactorToDelete;
		if (!factor) return;
		deletingMfaFactorId = factor.id;
		securityMessage = null;
		securityError = null;

		try {
			const result = await deleteMfaFactorRequest(factor.id);
			if (!result.ok) {
				securityError = result.error;
				return;
			}

			mfaFactors = result.factors;
			mfaDeleteOpen = false;
			mfaFactorToDelete = null;
			securityMessage = 'Authenticator app removed.';
		} catch {
			securityError = 'Could not remove authenticator app.';
		} finally {
			deletingMfaFactorId = null;
		}
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
		try {
			const result = await changePasswordRequest({ currentPassword, newPassword });
			if (!result.ok) {
				passwordError = result.error;
				return;
			}

			passwordChangeOpen = false;
			securityMessage = 'Password changed.';
		} catch {
			passwordError = 'Could not change password.';
		} finally {
			passwordChangeBusy = false;
		}
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
					<McpSettingsSection
						{mcpServerUrl}
						{mcpKeys}
						{mcpKeysBusy}
						{rerollingMcpKeyId}
						{revokingMcpKeyId}
						{createdMcpKey}
						bind:mcpKeyFormOpen
						bind:mcpKeyLabel
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
						{toggleMcpHousehold}
						{createMcpAccessKey}
					/>
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

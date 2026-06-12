<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { Button } from '$lib/components/ui/button';
	import DeleteConfirmDialog from '$lib/components/delete-confirm-dialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as InputOTP from '$lib/components/ui/input-otp';
	import { Separator } from '$lib/components/ui/separator';
	import { cn } from '$lib/utils';
	import BadgeCheckIcon from '@lucide/svelte/icons/badge-check';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import type { Component } from 'svelte';

	type SettingsCategoryId = 'account' | 'security' | 'notifications' | 'billing';
	type User = { name: string; email: string; emailVerified: boolean };
	type UpdatedUser = { name: string | null; email: string; emailVerified: boolean };
	type MfaFactor = {
		id: string;
		type: 'totp';
		issuer: string;
		user: string;
		createdAt: string;
		updatedAt: string;
	};

	type SettingsCategory = {
		id: SettingsCategoryId;
		label: string;
		icon: Component;
		disabled?: boolean;
	};

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

	const verificationCodeMinLength = 6;
	const normalizedAccountEmail = $derived(accountEmail.trim().toLowerCase());
	const currentAccountEmail = $derived(user.email.trim().toLowerCase());
	const accountEmailChanged = $derived(
		Boolean(normalizedAccountEmail) && normalizedAccountEmail !== currentAccountEmail
	);
	const accountEmailVerified = $derived(
		Boolean(normalizedAccountEmail) && verifiedEmail === normalizedAccountEmail
	);
	const emailVerificationRequired = $derived(accountEmailChanged && !accountEmailVerified);
	const accountCanSave = $derived(!accountSaving && !emailVerificationRequired);

	const categories: SettingsCategory[] = [
		{ id: 'account', label: 'Account', icon: BadgeCheckIcon },
		{ id: 'security', label: 'Security', icon: ShieldCheckIcon },
		{ id: 'notifications', label: 'Notifications', icon: BellIcon, disabled: true },
		{ id: 'billing', label: 'Billing', icon: CreditCardIcon }
	];

	const activeCategoryDetails = $derived(
		categories.find((category) => category.id === activeCategory) ?? categories[0]
	);

	let lastSettingsUrlParam = $state<string | null>(null);

	const settingsCategoryFromUrl = (): SettingsCategoryId | null => {
		const settingsParam = page.url.searchParams.get('settings');
		if (!settingsParam) return null;
		return categories.some((category) => category.id === settingsParam)
			? (settingsParam as SettingsCategoryId)
			: 'account';
	};

	const chooseCategory = async (category: SettingsCategory) => {
		if (category.disabled) return;
		activeCategory = category.id;
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.set('settings', category.id);
		lastSettingsUrlParam = category.id;
		await goto(resolve(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` as Pathname), {
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
		void goto(resolve(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` as Pathname), {
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

	const readError = async (response: Response, fallback: string): Promise<string> => {
		try {
			const body = (await response.json()) as { message?: unknown };
			if (typeof body.message === 'string' && body.message.trim()) return body.message;
		} catch {
			// Keep the UI message generic when the server response is not JSON.
		}
		return fallback;
	};

	const saveAccount = async (event: SubmitEvent) => {
		event.preventDefault();
		if (emailVerificationRequired) return;
		accountSaving = true;
		accountMessage = null;
		accountError = null;

		const response = await fetch(resolve('/settings/account' as Pathname), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: accountName, email: accountEmail })
		});

		accountSaving = false;
		if (!response.ok) {
			accountError = await readError(response, 'Could not update account.');
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

		const response = await fetch(resolve('/settings/account/email-verification' as Pathname), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: normalizedAccountEmail })
		});

		emailVerificationBusy = false;
		if (!response.ok) {
			accountError = await readError(response, 'Could not send verification email.');
			return;
		}
		verificationEmail = normalizedAccountEmail;
		emailVerificationCode = '';
		lastVerificationAttempt = '';
		accountMessage = 'Verification code sent.';
	};

	const verifyEmailCode = async (email: string, code: string) => {
		const attemptKey = `${email}:${code}`;
		lastVerificationAttempt = attemptKey;
		emailVerificationChecking = true;
		accountMessage = null;
		accountError = null;

		const response = await fetch(resolve('/settings/account/email-verification' as Pathname), {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, code })
		});

		emailVerificationChecking = false;
		if (!response.ok) {
			accountError = await readError(response, 'That code did not match.');
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
			lastVerificationAttempt === `${email}:${code}`
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

		const response = await fetch(resolve('/settings/security/mfa' as Pathname));
		mfaFactorsBusy = false;
		if (!response.ok) {
			securityError = await readError(response, 'Could not load two-factor methods.');
			return;
		}

		const body = (await response.json()) as { factors: MfaFactor[] };
		mfaFactors = body.factors;
		mfaFactorsLoaded = true;
	};

	$effect(() => {
		if (open && activeCategory === 'security') void loadMfaFactors();
	});

	const startMfaSetup = async () => {
		mfaSetupBusy = true;
		securityMessage = null;
		securityError = null;

		const response = await fetch(resolve('/settings/security/mfa' as Pathname), {
			method: 'POST'
		});

		mfaSetupBusy = false;
		if (!response.ok) {
			securityError = await readError(response, 'Could not start two-factor setup.');
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

		const response = await fetch(resolve('/settings/security/mfa' as Pathname), {
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
			securityError = await readError(response, 'That code did not match.');
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

		const response = await fetch(resolve('/settings/security/mfa' as Pathname), {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ factorId: factor.id })
		});

		deletingMfaFactorId = null;
		if (!response.ok) {
			securityError = await readError(response, 'Could not remove two-factor method.');
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
		currentPassword = '';
		newPassword = '';
		confirmPassword = '';
		passwordMessage = null;
		passwordError = null;
		passwordChangeOpen = true;
	};

	const changePassword = async () => {
		passwordMessage = null;
		passwordError = null;
		if (newPassword !== confirmPassword) {
			passwordError = 'Passwords do not match.';
			return;
		}

		passwordChangeBusy = true;
		const response = await fetch(resolve('/settings/security/password' as Pathname), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ currentPassword, newPassword })
		});

		passwordChangeBusy = false;
		if (!response.ok) {
			passwordError = await readError(response, 'Could not change password.');
			return;
		}

		passwordChangeOpen = false;
		securityMessage = 'Password changed.';
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="max-h-[min(36rem,calc(100svh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl"
	>
		<div class="grid min-h-[26rem] md:grid-cols-[12rem_minmax(0,1fr)]">
			<aside class="border-b border-border bg-muted/25 p-2 md:border-r md:border-b-0">
				<Dialog.Header class="px-2 py-2">
					<Dialog.Title>Settings</Dialog.Title>
				</Dialog.Header>
				<nav aria-label="Settings categories" class="mt-1 grid gap-1">
					{#each categories as category (category.id)}
						<button
							type="button"
							disabled={category.disabled}
							class={cn(
								'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-xs/relaxed transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none',
								category.disabled &&
									'cursor-not-allowed text-muted-foreground/45 opacity-60 hover:bg-transparent',
								activeCategory === category.id &&
									'bg-background text-foreground shadow-sm ring-1 ring-border'
							)}
							aria-current={activeCategory === category.id ? 'page' : undefined}
							title={category.disabled ? 'Coming soon' : undefined}
							onclick={() => void chooseCategory(category)}
						>
							<category.icon class="size-3.5 shrink-0" />
							<span class="truncate font-medium">{category.label}</span>
							{#if category.disabled}
								<span class="ml-auto text-[0.625rem] font-medium">Soon</span>
							{/if}
						</button>
					{/each}
				</nav>
			</aside>

			<section class="min-h-0 overflow-y-auto p-4">
				<div class="mb-4 flex items-center gap-2">
					<activeCategoryDetails.icon class="size-4" />
					<h2 class="text-sm font-medium">{activeCategoryDetails.label}</h2>
				</div>

				{#if activeCategory === 'account'}
					<form class="grid max-w-sm gap-3" onsubmit={saveAccount}>
						<label class="grid gap-1 text-xs font-medium">
							Name
							<Input bind:value={accountName} name="name" autocomplete="name" class="h-8" />
						</label>
						<label class="grid gap-1 text-xs font-medium">
							Email
							<Input
								bind:value={accountEmail}
								name="email"
								type="email"
								autocomplete="email"
								class="h-8"
							/>
						</label>
						{#if accountEmailChanged}
							<div class="grid gap-2 text-xs">
								<div class="flex items-center justify-between gap-3">
									<span
										class={accountEmailVerified ? 'text-meal-load-low' : 'text-muted-foreground'}
									>
										{accountEmailVerified ? 'Email verified' : 'Verify this email to save'}
									</span>
									{#if emailVerificationRequired}
										<Button
											variant="outline"
											size="sm"
											disabled={emailVerificationBusy || !normalizedAccountEmail}
											onclick={sendVerificationEmail}
										>
											{emailVerificationBusy ? 'Sending…' : 'Send code'}
										</Button>
									{/if}
								</div>
								{#if emailVerificationRequired}
									<div class="grid gap-1">
										<InputOTP.Root
											maxlength={6}
											bind:value={emailVerificationCode}
											disabled={emailVerificationBusy ||
												verificationEmail !== normalizedAccountEmail}
											aria-label="Verification code"
											class="gap-1.5"
										>
											{#snippet children({ cells })}
												<InputOTP.Group>
													{#each cells as cell, index (index)}
														<InputOTP.Slot {cell} />
													{/each}
												</InputOTP.Group>
											{/snippet}
										</InputOTP.Root>
										{#if emailVerificationChecking}
											<span class="text-muted-foreground">Checking code…</span>
										{:else if verificationEmail !== normalizedAccountEmail}
											<span class="text-muted-foreground">Send a code to continue.</span>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
						<div class="flex items-center gap-3 pt-1">
							<Button type="submit" disabled={!accountCanSave}
								>{accountSaving ? 'Saving…' : 'Save'}</Button
							>
							{#if accountMessage}<span class="text-xs text-muted-foreground">{accountMessage}</span
								>{/if}
							{#if accountError}<span class="text-xs text-destructive">{accountError}</span>{/if}
						</div>
					</form>
				{:else if activeCategory === 'security'}
					<div class="grid max-w-lg gap-4 text-sm">
						<div class="flex items-center justify-between gap-4">
							<div>Password</div>
							<Button variant="outline" onclick={openPasswordChange}>Change</Button>
						</div>
						<Separator />
						<div class="grid gap-3">
							<div class="flex items-center justify-between gap-4">
								<div>Two-factor authentication</div>
								<Button variant="outline" disabled={mfaSetupBusy} onclick={startMfaSetup}>
									{mfaSetupBusy ? 'Starting…' : mfaFactors.length ? 'Replace' : 'Set up'}
								</Button>
							</div>
							{#if mfaFactorsBusy}
								<p class="text-xs text-muted-foreground">Loading methods…</p>
							{:else if mfaFactors.length === 0}
								<p class="text-xs text-muted-foreground">No authenticator app is set up.</p>
							{:else}
								<ul class="divide-y rounded-md border border-border">
									{#each mfaFactors as factor (factor.id)}
										<li class="flex items-center justify-between gap-3 px-3 py-2">
											<div class="min-w-0">
												<p class="truncate text-xs font-medium">{factor.issuer}</p>
												<p class="truncate text-xs text-muted-foreground">{factor.user}</p>
											</div>
											<Button
												variant="outline"
												size="sm"
												disabled={deletingMfaFactorId === factor.id}
												onclick={() => confirmDeleteMfaFactor(factor)}
											>
												{deletingMfaFactorId === factor.id ? 'Removing…' : 'Remove'}
											</Button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
						{#if securityMessage}<p class="text-xs text-muted-foreground">{securityMessage}</p>{/if}
						{#if securityError}<p class="text-xs text-destructive">{securityError}</p>{/if}
					</div>
				{:else if activeCategory === 'notifications'}
					<div class="grid max-w-lg gap-3 text-sm opacity-50 grayscale">
						<p class="text-xs text-muted-foreground">Notifications are coming later.</p>
						<label class="flex cursor-not-allowed items-center justify-between gap-4">
							Planning reminders
							<input type="checkbox" class="size-4 accent-primary" disabled />
						</label>
						<label class="flex cursor-not-allowed items-center justify-between gap-4">
							Meal check-ins
							<input type="checkbox" class="size-4 accent-primary" disabled />
						</label>
					</div>
				{:else if activeCategory === 'billing'}
					<div class="flex max-w-lg items-center justify-between gap-4 text-sm">
						<div>Plan</div>
						<Button variant="outline" disabled>Manage billing</Button>
					</div>
				{/if}
			</section>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={passwordChangeOpen}>
	<Dialog.Content class="sm:max-w-[24rem]">
		<Dialog.Header>
			<Dialog.Title>Change password</Dialog.Title>
			<Dialog.Description>Enter your current password before choosing a new one.</Dialog.Description
			>
		</Dialog.Header>
		<div class="grid gap-3">
			<label class="grid gap-1 text-xs font-medium">
				Current password
				<Input
					bind:value={currentPassword}
					type="password"
					autocomplete="current-password"
					class="h-8"
				/>
			</label>
			<label class="grid gap-1 text-xs font-medium">
				New password
				<Input bind:value={newPassword} type="password" autocomplete="new-password" class="h-8" />
			</label>
			<label class="grid gap-1 text-xs font-medium">
				Confirm new password
				<Input
					bind:value={confirmPassword}
					type="password"
					autocomplete="new-password"
					class="h-8"
				/>
			</label>
			{#if passwordMessage}<p class="text-xs text-muted-foreground">{passwordMessage}</p>{/if}
			{#if passwordError}<p class="text-xs text-destructive">{passwordError}</p>{/if}
			<div class="flex justify-end gap-2">
				<Button
					variant="ghost"
					disabled={passwordChangeBusy}
					onclick={() => (passwordChangeOpen = false)}
				>
					Cancel
				</Button>
				<Button
					disabled={passwordChangeBusy || !currentPassword || !newPassword || !confirmPassword}
					onclick={changePassword}
				>
					{passwordChangeBusy ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

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

<Dialog.Root bind:open={mfaSetupOpen}>
	<Dialog.Content class="sm:max-w-[26rem]">
		<Dialog.Header>
			<Dialog.Title>Set up two-factor authentication</Dialog.Title>
			<Dialog.Description>
				Scan the QR code with your authenticator app, then enter the 6-digit code.
			</Dialog.Description>
		</Dialog.Header>
		{#if mfaSetup}
			<div class="grid gap-4">
				<div class="flex justify-center">
					<img
						src={mfaSetup.qrCode}
						alt="Authenticator app QR code"
						class="size-44 rounded-md border border-border bg-white p-2"
					/>
				</div>
				<div class="grid gap-1 text-xs text-muted-foreground">
					<span>Manual setup key</span>
					<code class="rounded-md bg-muted px-2 py-1 break-all text-foreground"
						>{mfaSetup.secret}</code
					>
				</div>
				<div class="grid justify-center gap-2">
					<InputOTP.Root maxlength={6} bind:value={mfaCode} aria-label="Authenticator code">
						{#snippet children({ cells })}
							<InputOTP.Group>
								{#each cells as cell, index (index)}
									<InputOTP.Slot {cell} />
								{/each}
							</InputOTP.Group>
						{/snippet}
					</InputOTP.Root>
				</div>
				<div class="flex justify-end gap-2">
					<Button variant="ghost" disabled={mfaVerifyBusy} onclick={() => (mfaSetupOpen = false)}>
						Cancel
					</Button>
					<Button
						disabled={mfaVerifyBusy || mfaCode.trim().length < verificationCodeMinLength}
						onclick={verifyMfaSetup}
					>
						{mfaVerifyBusy ? 'Verifying…' : 'Verify'}
					</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

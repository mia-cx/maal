<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as InputOTP from '$lib/components/ui/input-otp';

	let {
		accountName = $bindable(''),
		accountEmail = $bindable(''),
		emailVerificationCode = $bindable(''),
		verificationEmail,
		normalizedAccountEmail,
		accountEmailChanged,
		accountEmailVerified,
		emailVerificationRequired,
		emailVerificationBusy,
		emailVerificationChecking,
		accountCanSave,
		accountSaving,
		accountMessage,
		accountError,
		saveAccount,
		sendVerificationEmail
	}: {
		accountName: string;
		accountEmail: string;
		emailVerificationCode: string;
		verificationEmail: string | null;
		normalizedAccountEmail: string;
		accountEmailChanged: boolean;
		accountEmailVerified: boolean;
		emailVerificationRequired: boolean;
		emailVerificationBusy: boolean;
		emailVerificationChecking: boolean;
		accountCanSave: boolean;
		accountSaving: boolean;
		accountMessage: string | null;
		accountError: string | null;
		saveAccount: (event: SubmitEvent) => void | Promise<void>;
		sendVerificationEmail: () => void | Promise<void>;
	} = $props();
</script>

<form class="grid gap-3" onsubmit={saveAccount}>
	<label class="grid gap-1 text-xs font-medium">
		Name
		<Input bind:value={accountName} name="name" autocomplete="name" class="h-8" />
	</label>
	<label class="grid gap-1 text-xs font-medium">
		Email
		<Input bind:value={accountEmail} name="email" type="email" autocomplete="email" class="h-8" />
	</label>
	{#if accountEmailChanged}
		<div class="grid gap-2 text-xs">
			<div class="flex items-center justify-between gap-3">
				<span class={accountEmailVerified ? 'text-meal-load-low' : 'text-muted-foreground'}>
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
						disabled={emailVerificationBusy || verificationEmail !== normalizedAccountEmail}
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
		<Button type="submit" disabled={!accountCanSave}>{accountSaving ? 'Saving…' : 'Save'}</Button>
		{#if accountMessage}<span class="text-xs text-muted-foreground">{accountMessage}</span>{/if}
		{#if accountError}<span class="text-xs text-destructive">{accountError}</span>{/if}
	</div>
</form>

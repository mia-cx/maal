<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import * as InputOTP from '$lib/components/ui/input-otp';

	type MfaSetup = {
		factorId: string;
		challengeId: string;
		qrCode: string;
		secret: string;
	};

	let {
		open = $bindable(false),
		mfaCode = $bindable(''),
		mfaSetup,
		mfaVerifyBusy,
		verificationCodeMinLength,
		verifyMfaSetup
	}: {
		open: boolean;
		mfaCode: string;
		mfaSetup: MfaSetup | null;
		mfaVerifyBusy: boolean;
		verificationCodeMinLength: number;
		verifyMfaSetup: () => void;
	} = $props();
</script>

<Dialog.Root bind:open>
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
					<Button variant="ghost" disabled={mfaVerifyBusy} onclick={() => (open = false)}>
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

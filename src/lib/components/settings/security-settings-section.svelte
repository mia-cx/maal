<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import type { MfaFactor } from '$lib/settings/types';

	let {
		mfaSetupBusy,
		mfaFactorsBusy,
		mfaFactors,
		deletingMfaFactorId,
		securityMessage,
		securityError,
		openPasswordChange,
		startMfaSetup,
		confirmDeleteMfaFactor
	}: {
		mfaSetupBusy: boolean;
		mfaFactorsBusy: boolean;
		mfaFactors: MfaFactor[];
		deletingMfaFactorId: string | null;
		securityMessage: string | null;
		securityError: string | null;
		openPasswordChange: () => void;
		startMfaSetup: () => void | Promise<void>;
		confirmDeleteMfaFactor: (factor: MfaFactor) => void | Promise<void>;
	} = $props();
</script>

<div class="grid max-w-lg gap-5 text-sm">
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
			<ul class="divide-y divide-border">
				{#each mfaFactors as factor (factor.id)}
					<li class="flex items-center justify-between gap-3 py-2">
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

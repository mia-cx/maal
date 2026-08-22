<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import {
		beginCheckout,
		beginTrial,
		openBillingPortal,
		refreshBillingProjection,
		shouldRefreshBillingOnLaunch,
		transferBillingOwner
	} from '$lib/client/billing.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import BillingPlanPicker from '$lib/components/billing/billing-plan-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type {
		BillingCapability,
		BillingPrice,
		BillingProjectionEnvelope
	} from '$lib/domain/billing/contracts.js';

	let {
		database,
		profileId,
		householdId,
		householdName,
		workosUserId,
		localOnly,
		transferCandidates,
		showHeading = true
	}: {
		database: MaalDatabase;
		profileId: string;
		householdId: string;
		householdName: string;
		workosUserId: string;
		localOnly: boolean;
		transferCandidates: readonly { workosUserId: string; name: string }[];
		showHeading?: boolean;
	} = $props();

	let capability = $state<BillingCapability | null>(null);
	let prices = $state<readonly BillingPrice[]>([]);
	let trialAvailable = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let selectedTransferUserId = $state('');

	const capabilityLabel = $derived(
		capability?.state === 'enabled'
			? capability.stripeStatus === 'trialing'
				? 'Trial active'
				: capability.cancelAtPeriodEnd
					? 'Active · cancels at period end'
					: 'Active'
			: capability?.state === 'grace'
				? `Grace period · through ${new Date(capability.graceUntil!).toLocaleDateString()}`
				: 'No active plan'
	);
	const ownsBilling = $derived(capability?.subscriberUserId === workosUserId);

	const useProjection = (projection: BillingProjectionEnvelope) => {
		capability = projection.capability;
		prices = projection.prices;
		trialAvailable = projection.trialAvailable;
	};

	const refresh = async () => {
		if (busy || localOnly) return;
		busy = true;
		error = null;
		try {
			useProjection(await refreshBillingProjection(database, profileId, householdId));
		} catch {
			error = 'Billing could not be refreshed. Local meal planning is still available.';
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		const subscription = liveQuery(async () => {
			const [nextCapability, meta] = await Promise.all([
				database.billingCapabilities.get(householdId),
				database.remoteProjectionMeta.get(`billing:${householdId}`)
			]);
			const value = meta?.value;
			return {
				capability: nextCapability ?? null,
				prices:
					typeof value === 'object' &&
					value !== null &&
					'prices' in value &&
					Array.isArray(value.prices)
						? (value.prices as BillingPrice[])
						: [],
				trialAvailable:
					typeof value === 'object' &&
					value !== null &&
					'trialAvailable' in value &&
					value.trialAvailable === true
			};
		}).subscribe((value) => {
			capability = value.capability;
			prices = value.prices;
			trialAvailable = value.trialAvailable;
		});
		void shouldRefreshBillingOnLaunch(database, householdId).then((shouldRefresh) => {
			if (shouldRefresh) void refresh();
		});
		return () => subscription.unsubscribe();
	});

	const checkout = async (priceId: string) => {
		busy = true;
		error = null;
		try {
			const { url } = await beginCheckout(database, profileId, householdId, priceId);
			window.location.assign(url);
		} catch {
			error = 'Checkout could not be opened.';
			busy = false;
		}
	};

	const trial = async (priceId: string) => {
		busy = true;
		error = null;
		try {
			await beginTrial(database, profileId, householdId, priceId);
			await refreshBillingProjection(database, profileId, householdId).then(useProjection);
		} catch {
			error = 'This user or household has already used a trial, or the trial could not be started.';
		} finally {
			busy = false;
		}
	};

	const portal = async () => {
		busy = true;
		error = null;
		try {
			const { url } = await openBillingPortal(database, profileId, householdId);
			window.location.assign(url);
		} catch {
			error = 'The billing portal could not be opened.';
			busy = false;
		}
	};

	const transfer = async () => {
		if (!selectedTransferUserId) return;
		busy = true;
		error = null;
		try {
			await transferBillingOwner(database, profileId, householdId, selectedTransferUserId);
			await refreshBillingProjection(database, profileId, householdId).then(useProjection);
			selectedTransferUserId = '';
		} catch {
			error = 'Billing ownership could not be transferred to that household manager.';
		} finally {
			busy = false;
		}
	};
</script>

<section
	class="grid gap-4"
	class:border-t={showHeading}
	class:border-border={showHeading}
	class:pt-4={showHeading}
	aria-label="Billing"
>
	{#if showHeading}
		<div class="grid gap-1">
			<h2 class="text-sm font-medium">Billing</h2>
			<p class="text-xs text-muted-foreground">
				Local meal planning stays free. One Maal plan adds sync, MCP, and hosted services for {householdName}.
			</p>
		</div>
	{:else}
		<p class="text-xs text-muted-foreground">
			Local meal planning stays free. One Maal plan adds sync, MCP, and hosted services for {householdName}.
		</p>
	{/if}

	{#if localOnly}
		<p class="text-xs text-muted-foreground">
			Connect this local household to a signed-in household before subscribing.
		</p>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3 py-2">
			<div class="min-w-0">
				<p class="truncate text-xs font-medium">{householdName} · current</p>
				<p class="truncate text-xs text-muted-foreground">{capabilityLabel}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				{#if capability?.state === 'enabled' || capability?.state === 'grace'}
					{#if ownsBilling}
						<Button variant="outline" size="sm" disabled={busy} onclick={() => void portal()}>
							{busy ? 'Opening…' : 'Manage subscription'}
						</Button>
					{/if}
				{:else if prices.length === 0}
					<Button variant="outline" size="sm" disabled={busy} onclick={() => void refresh()}>
						{busy ? 'Loading…' : 'See plans'}
					</Button>
				{/if}
			</div>
		</div>

		{#if capability?.state === 'grace'}
			<p
				class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
			>
				Remote services remain available during this continuous 30-day grace period. Local use is
				unaffected afterward.
			</p>
		{/if}

		{#if capability?.state !== 'enabled' && capability?.state !== 'grace' && prices.length > 0}
			<BillingPlanPicker
				pricing={prices}
				{trialAvailable}
				disabled={busy}
				onselect={(priceId) => void checkout(priceId)}
				ontrial={(priceId) => void trial(priceId)}
			/>
		{/if}

		{#if ownsBilling && transferCandidates.length > 0}
			<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
				<label class="grid gap-1 text-xs font-medium">
					Transfer billing ownership
					<Select.Root type="single" bind:value={selectedTransferUserId}>
						<Select.Trigger class="!h-9 w-full text-sm">
							{transferCandidates.find(({ workosUserId: id }) => id === selectedTransferUserId)
								?.name ?? 'Choose a household manager'}
						</Select.Trigger>
						<Select.Content>
							{#each transferCandidates as candidate (candidate.workosUserId)}
								<Select.Item value={candidate.workosUserId}>{candidate.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</label>
				<Button
					type="button"
					variant="outline"
					disabled={busy || !selectedTransferUserId}
					onclick={() => void transfer()}>Transfer</Button
				>
			</div>
		{/if}
	{/if}

	{#if error}<p class="text-xs text-destructive" aria-live="polite">{error}</p>{/if}
</section>

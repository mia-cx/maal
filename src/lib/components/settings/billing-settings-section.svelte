<script lang="ts">
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import {
		beginCheckout,
		beginTrial,
		LocalBillingRequestFailed,
		openBillingPortal,
		refreshBillingProjection,
		transferBillingOwner
	} from '$lib/client/billing.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import * as m from '$lib/paraglide/messages.js';
	import BillingPlanPicker from '$lib/components/billing/billing-plan-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type {
		BillingCapability,
		BillingPrice,
		BillingProjectionEnvelope
	} from '$lib/domain/billing/contracts.js';
	import { hasCachedPermission } from '$lib/domain/household/permissions.js';

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

	let canManage = $state(false);

	const capabilityLabel = $derived(
		capability?.state === 'enabled'
			? capability.stripeStatus === 'trialing'
				? m.billing_trial_active()
				: capability.cancelAtPeriodEnd
					? `${m.billing_active()} · ${m.billing_cancels_at_period_end()}`
					: m.billing_active()
			: capability?.state === 'grace'
				? m.billing_grace_through({
						date: new Date(capability.graceUntil!).toLocaleDateString()
					})
				: m.billing_no_active_plan()
	);
	const hasPlan = $derived(capability?.state === 'enabled' || capability?.state === 'grace');
	// The Worker opens the portal only for the billing owner, and only while they can manage.
	const ownsBilling = $derived(canManage && capability?.subscriberUserId === workosUserId);

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
			error = m.billing_refresh_failed();
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		const subscription = liveQuery(async () => {
			const [nextCapability, meta, membership] = await Promise.all([
				database.billingCapabilities.get(householdId),
				database.remoteProjectionMeta.get(`billing:${householdId}`),
				database.memberships
					.where('[householdId+workosUserId]')
					.equals([householdId, workosUserId])
					.first()
			]);
			const value = meta?.value;
			return {
				canManage: hasCachedPermission(membership, 'households:write'),
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
			canManage = value.canManage;
			capability = value.capability;
			prices = value.prices;
			trialAvailable = value.trialAvailable;
		});
		return () => subscription.unsubscribe();
	});

	const checkout = async (priceId: string) => {
		busy = true;
		error = null;
		try {
			const { url } = await beginCheckout(database, profileId, householdId, priceId);
			window.location.assign(url);
		} catch (cause) {
			// The Worker refuses a second checkout while Stripe still holds a subscription; the
			// billing owner fixes that in the portal, anyone else just needs to know why.
			if (
				cause instanceof LocalBillingRequestFailed &&
				cause.safeMessage.includes('already_subscribed')
			) {
				if (ownsBilling) return portal();
				error = m.billing_checkout_already_subscribed();
			} else {
				error = m.billing_checkout_failed();
			}
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
			error = m.billing_trial_failed();
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
			error = m.billing_portal_failed();
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
			error = m.billing_transfer_failed();
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
	aria-label={m.settings_billing()}
>
	{#if showHeading}
		<div class="grid gap-1">
			<h2 class="text-sm font-medium">{m.settings_billing()}</h2>
			<p class="text-xs text-muted-foreground">
				{m.billing_plan_adds_services_for_household({ householdName })}
			</p>
		</div>
	{:else}
		<p class="text-xs text-muted-foreground">
			{m.billing_plan_adds_services_for_household({ householdName })}
		</p>
	{/if}

	{#if localOnly}
		<p class="text-xs text-muted-foreground">
			{m.billing_connect_household_before_subscribing({ householdName })}
		</p>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3 py-2">
			<div class="min-w-0">
				<p class="truncate text-xs font-medium">{householdName} · {m.billing_current()}</p>
				<p class="truncate text-xs text-muted-foreground">{capabilityLabel}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				{#if ownsBilling}
					<Button variant="outline" size="sm" disabled={busy} onclick={() => void portal()}>
						{busy ? m.billing_opening() : m.billing_manage_subscriptions()}
					</Button>
				{:else if canManage && !hasPlan && prices.length === 0}
					<Button variant="outline" size="sm" disabled={busy} onclick={() => void refresh()}>
						{busy ? m.settings_loading_billing() : m.billing_see_plans()}
					</Button>
				{:else}
					<Button variant="outline" size="sm" disabled={busy} onclick={() => void refresh()}>
						{busy ? m.settings_loading_billing() : m.settings_refresh()}
					</Button>
				{/if}
			</div>
		</div>

		{#if capability?.state === 'grace'}
			<p
				class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
			>
				{m.billing_grace_notice()}
			</p>
		{/if}

		{#if canManage && !hasPlan && prices.length > 0}
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
					{m.billing_transfer_ownership()}
					<Select.Root type="single" bind:value={selectedTransferUserId}>
						<Select.Trigger class="!h-9 w-full text-sm">
							{transferCandidates.find(({ workosUserId: id }) => id === selectedTransferUserId)
								?.name ?? m.billing_choose_household_manager()}
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
					onclick={() => void transfer()}>{m.billing_transfer()}</Button
				>
			</div>
		{/if}
	{/if}

	{#if error}<p class="text-xs text-destructive" aria-live="polite">{error}</p>{/if}
</section>

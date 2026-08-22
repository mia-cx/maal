<script lang="ts">
	import { goto } from '$app/navigation';
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	import {
		beginCheckout,
		beginTrial,
		openBillingPortal,
		refreshBillingProjection
	} from '$lib/client/billing.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { activeHouseholdKey } from '$lib/client/local/profiles.js';
	import BillingPlanPicker from '$lib/components/billing/billing-plan-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import type {
		BillingCapability,
		BillingPrice,
		BillingProjectionEnvelope
	} from '$lib/domain/billing/contracts.js';

	type SubscribeView = {
		profileId: string;
		householdId: string;
		householdName: string;
		localOnly: boolean;
		canManage: boolean;
		capability: BillingCapability | null;
		prices: readonly BillingPrice[];
		trialAvailable: boolean;
	};

	let database = $state<MaalDatabase | null>(null);
	let view = $state<SubscribeView | null>(null);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let requestedProjectionFor = $state<string | null>(null);

	const useProjection = (projection: BillingProjectionEnvelope) => {
		if (!view || projection.capability.householdId !== view.householdId) return;
		view = {
			...view,
			capability: projection.capability,
			prices: projection.prices,
			trialAvailable: projection.trialAvailable
		};
	};

	const readView = async (local: MaalDatabase): Promise<SubscribeView | null> => {
		const active = await local.uiState.get('activeProfileId');
		const profileId = typeof active?.value === 'string' ? active.value : null;
		if (!profileId) return null;
		const profile = await local.profiles.get(profileId);
		if (!profile) return null;
		const householdState = await local.uiState.get(activeHouseholdKey(profileId));
		const householdId = typeof householdState?.value === 'string' ? householdState.value : null;
		if (!householdId) return null;
		const [household, membership, capability, projection] = await Promise.all([
			local.households.get(householdId),
			local.memberships
				.where('[householdId+workosUserId]')
				.equals([householdId, profile.workosUserId])
				.first(),
			local.billingCapabilities.get(householdId),
			local.remoteProjectionMeta.get(`billing:${householdId}`)
		]);
		if (!household) return null;
		const value = projection?.value;
		return {
			profileId,
			householdId,
			householdName: household.name,
			localOnly: household.localOnly,
			canManage:
				household.localOnly ||
				Boolean(
					membership?.status === 'active' &&
					(membership.roleSlug === 'admin' || membership.permissions.includes('households:write'))
				),
			capability: capability ?? null,
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
	};

	const refresh = async (local: MaalDatabase, current: SubscribeView) => {
		if (current.localOnly || !current.canManage || requestedProjectionFor === current.householdId)
			return;
		requestedProjectionFor = current.householdId;
		busy = true;
		error = null;
		try {
			useProjection(await refreshBillingProjection(local, current.profileId, current.householdId));
		} catch {
			error = 'Plans could not be loaded. Check the connection and try again.';
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		let subscription: { unsubscribe: () => void } | null = null;
		void getBrowserDatabase()
			.then((local) => {
				database = local;
				subscription = liveQuery(() => readView(local)).subscribe({
					next: (next) => {
						view = next;
						loading = false;
						if (next) void refresh(local, next);
					},
					error: () => {
						loading = false;
						error = 'Local billing details could not be read.';
					}
				});
			})
			.catch(() => {
				loading = false;
				error = 'Local data could not be opened.';
			});
		return () => subscription?.unsubscribe();
	});

	const checkout = async (priceId: string) => {
		if (!database || !view) return;
		busy = true;
		error = null;
		try {
			const { url } = await beginCheckout(database, view.profileId, view.householdId, priceId);
			window.location.assign(url);
		} catch {
			error = 'Checkout could not be opened.';
			busy = false;
		}
	};

	const trial = async (priceId: string) => {
		if (!database || !view) return;
		busy = true;
		error = null;
		try {
			await beginTrial(database, view.profileId, view.householdId, priceId);
			await refreshBillingProjection(database, view.profileId, view.householdId).then(
				useProjection
			);
		} catch {
			error = 'This user or household has already used a trial, or the trial could not be started.';
		} finally {
			busy = false;
		}
	};

	const portal = async () => {
		if (!database || !view) return;
		busy = true;
		error = null;
		try {
			const { url } = await openBillingPortal(database, view.profileId, view.householdId);
			window.location.assign(url);
		} catch {
			error = 'The billing portal could not be opened.';
			busy = false;
		}
	};
</script>

<svelte:head><title>Start subscription · Maal</title></svelte:head>

<section
	class="grid min-h-svh items-start justify-items-center overflow-y-auto bg-background px-4 py-12 text-foreground md:place-items-center md:py-16"
>
	<div class="mx-auto grid w-full max-w-5xl gap-10">
		<div class="grid justify-items-center gap-5 text-center">
			<WordmarkLogo class="h-8 w-auto" />
			<div class="grid gap-3">
				<h1 class="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
					{view ? `Choose a plan for ${view.householdName}` : 'Choose a Maal plan'}
				</h1>
				<p class="mx-auto max-w-2xl text-sm text-muted-foreground">
					One plan adds sync, MCP, and hosted services. Local meal planning stays free.
				</p>
			</div>
		</div>

		{#if loading}
			<p class="text-center text-sm text-muted-foreground">Opening local billing details…</p>
		{:else if !view}
			<div class="grid justify-items-center gap-3 text-center">
				<p class="text-sm text-muted-foreground">Choose a local profile and household first.</p>
				<Button href="/household" variant="outline">Open household settings</Button>
			</div>
		{:else if view.localOnly}
			<div class="grid justify-items-center gap-3 text-center">
				<p class="text-sm text-muted-foreground">
					Connect {view.householdName} to a signed-in household before subscribing.
				</p>
				<Button href="/household" variant="outline">Open household settings</Button>
			</div>
		{:else if !view.canManage}
			<p class="text-center text-sm text-muted-foreground">
				A household manager must start or manage this subscription.
			</p>
		{:else if view.capability?.state === 'enabled' || view.capability?.state === 'grace'}
			<div class="grid justify-items-center gap-3 text-center">
				<p class="text-sm text-muted-foreground">{view.householdName} already has Maal service.</p>
				<div class="flex flex-wrap justify-center gap-2">
					<Button disabled={busy} onclick={() => void portal()}>
						{busy ? 'Opening…' : 'Manage subscription'}
					</Button>
					<Button variant="outline" onclick={() => goto('/plan')}>Back to meal plan</Button>
				</div>
			</div>
		{:else if view.prices.length > 0}
			<BillingPlanPicker
				pricing={view.prices}
				trialAvailable={view.trialAvailable}
				disabled={busy}
				onselect={(priceId) => void checkout(priceId)}
				ontrial={(priceId) => void trial(priceId)}
			/>
		{:else if !busy}
			<div class="grid justify-items-center gap-3 text-center">
				<p class="text-sm text-muted-foreground">Pricing is temporarily unavailable.</p>
				<Button
					variant="outline"
					onclick={() => {
						requestedProjectionFor = null;
						if (database) void refresh(database, view);
					}}>Try again</Button
				>
			</div>
		{/if}
		{#if error}<p class="text-center text-sm text-destructive" role="alert">{error}</p>{/if}
	</div>
</section>

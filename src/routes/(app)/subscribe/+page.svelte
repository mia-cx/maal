<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
	import * as m from '$lib/paraglide/messages.js';
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
		ownsBilling: boolean;
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
		const canManage =
			household.localOnly ||
			Boolean(
				membership?.status === 'active' &&
				(membership.roleSlug === 'admin' || membership.permissions.includes('households:write'))
			);
		return {
			profileId,
			householdId,
			householdName: household.name,
			localOnly: household.localOnly,
			canManage,
			// The Worker opens the portal only for the billing owner.
			ownsBilling: canManage && capability?.subscriberUserId === profile.workosUserId,
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
			error = m.billing_plans_load_failed();
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
						error = m.billing_local_details_unreadable();
					}
				});
			})
			.catch(() => {
				loading = false;
				error = m.billing_local_data_unavailable();
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
			error = m.billing_checkout_failed();
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
			error = m.billing_trial_failed();
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
			error = m.billing_portal_failed();
			busy = false;
		}
	};
</script>

<svelte:head><title>{m.billing_start_subscription_maal()}</title></svelte:head>

<section
	class="grid min-h-svh items-start justify-items-center overflow-y-auto bg-background px-4 py-12 text-foreground md:place-items-center md:py-16"
>
	<div class="mx-auto grid w-full max-w-5xl gap-10">
		<div class="grid justify-items-center gap-5 text-center">
			<WordmarkLogo class="h-8 w-auto" />
			<div class="grid gap-3">
				<h1 class="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
					{view
						? m.billing_choose_a_plan_for_household({ householdName: view.householdName })
						: m.billing_choose_a_maal_plan()}
				</h1>
				<p class="mx-auto max-w-2xl text-sm text-muted-foreground">
					{view
						? m.billing_subscription_applies_to_household({ householdName: view.householdName })
						: m.billing_plan_adds_services()}
				</p>
			</div>
		</div>

		{#if loading}
			<p class="text-center text-sm text-muted-foreground">{m.settings_loading_billing()}</p>
		{:else if !view}
			<div class="grid justify-items-center gap-3 text-center">
				<p class="text-sm text-muted-foreground">
					{m.billing_choose_profile_and_household_first()}
				</p>
				<Button href="/household" variant="outline">{m.household_household_settings()}</Button>
			</div>
		{:else if view.localOnly}
			<div class="grid justify-items-center gap-3 text-center">
				<p class="text-sm text-muted-foreground">
					{m.billing_connect_household_before_subscribing({ householdName: view.householdName })}
				</p>
				<Button href="/household" variant="outline">{m.household_household_settings()}</Button>
			</div>
		{:else if !view.canManage}
			<p class="text-center text-sm text-muted-foreground">{m.billing_manager_required()}</p>
		{:else if view.capability?.state === 'enabled' || view.capability?.state === 'grace'}
			<div class="grid justify-items-center gap-3 text-center">
				<p class="text-sm text-muted-foreground">
					{m.billing_household_has_service({ householdName: view.householdName })}
				</p>
				<div class="flex flex-wrap justify-center gap-2">
					{#if view.ownsBilling}
						<Button disabled={busy} onclick={() => void portal()}>
							{busy ? m.billing_opening() : m.billing_manage_subscriptions()}
						</Button>
					{/if}
					<Button variant="outline" onclick={() => goto(resolve('/plan'))}
						>{m.household_back_to_meal_plan()}</Button
					>
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
				<p class="text-sm text-muted-foreground">{m.billing_pricing_unavailable()}</p>
				<Button
					variant="outline"
					onclick={() => {
						requestedProjectionFor = null;
						const local = database;
						const currentView = view;
						if (local && currentView) void refresh(local, currentView);
					}}>{m.menu_try_again()}</Button
				>
			</div>
		{/if}
		{#if error}<p class="text-center text-sm text-destructive" role="alert">{error}</p>{/if}
	</div>
</section>

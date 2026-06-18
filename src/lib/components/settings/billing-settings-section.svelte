<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import type { BillingStatus } from '$lib/settings/types';

	let {
		billingBusy,
		billingStatus,
		billingPortalBusy,
		billingError,
		openBillingPortal
	}: {
		billingBusy: boolean;
		billingStatus: BillingStatus | null;
		billingPortalBusy: boolean;
		billingError: string | null;
		openBillingPortal: (householdId?: string) => void;
	} = $props();
</script>

<div class="grid gap-4 text-sm">
	{#if billingBusy && !billingStatus}
		<p class="text-xs text-muted-foreground">{m.settings_loading_billing()}</p>
	{:else if billingStatus}
		<div class="grid gap-2">
			<p class="text-xs font-medium">{m.settings_managed_household_subscriptions()}</p>
			<ul class="divide-y divide-border">
				{#each billingStatus.householdBilling as householdBilling (householdBilling.householdId)}
					<li class="flex items-center justify-between gap-3 py-2">
						<div class="min-w-0">
							<p class="truncate text-xs font-medium">
								{householdBilling.householdName}{householdBilling.isActiveHousehold
									? ` · ${m.billing_current()}`
									: ''}
							</p>
							<p class="truncate text-xs text-muted-foreground">
								{householdBilling.status
									? `${householdBilling.status}${householdBilling.cancelAtPeriodEnd ? ` · ${m.billing_cancels_at_period_end()}` : ''}`
									: m.billing_no_active_plan()}
							</p>
						</div>
						{#if householdBilling.stripeCustomerId && householdBilling.canManageBilling}
							<Button
								variant="outline"
								size="sm"
								disabled={billingPortalBusy}
								onclick={() => openBillingPortal(householdBilling.householdId)}
							>
								{billingPortalBusy ? m.billing_opening() : m.billing_manage_subscriptions()}
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if billingError}<p class="text-xs text-destructive">{billingError}</p>{/if}
</div>

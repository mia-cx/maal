<script lang="ts">
	import { resolve } from '$app/paths';
	import type { BillingPrice, BillingPriceInterval } from '$lib/domain/billing/contracts.js';
	import { Button } from '$lib/components/ui/button';

	const labels = { week: 'Weekly', month: 'Monthly', year: 'Yearly' } as const;

	let {
		pricing,
		signedIn = false,
		brand = '#fe7156'
	}: {
		pricing: BillingPrice[];
		signedIn?: boolean;
		brand?: string;
	} = $props();

	const money = (amount: number, currency: string): string =>
		new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency,
			maximumFractionDigits: amount % 100 === 0 ? 0 : 2
		}).format(amount / 100);

	const intervalLabel = (interval: BillingPriceInterval, intervalCount: number): string => {
		const label = intervalCount === 1 ? interval : `${interval}s`;
		return intervalCount === 1 ? label : `${intervalCount} ${label}`;
	};

	const planUseCase = (label: string): string => {
		if (label === 'Weekly') return 'Trying Maal without committing to a month.';
		if (label === 'Yearly') return 'Households that already know meal planning is staying.';
		return 'The normal rhythm for shared meal planning.';
	};

	const subscribeHref = resolve('/subscribe');
	const loginHref = resolve(`/auth/login?returnTo=${encodeURIComponent(subscribeHref)}`);
</script>

{#if pricing.length}
	<div class="grid gap-4 md:grid-cols-3">
		{#each pricing as price (price.id)}
			{@const label = labels[price.interval]}
			<div class="flex flex-col rounded-xl border border-border bg-card p-5">
				<div class="flex items-start justify-between gap-3">
					<h3 class="text-xl font-bold">{label}</h3>
					{#if price.interval === 'year'}
						<span
							class="rounded-full bg-[var(--brand)] px-2 py-0.5 text-[0.65rem] font-medium text-white"
							style={`--brand:${brand}`}>Best value</span
						>
					{/if}
				</div>
				<p class="mt-4">
					<span class="text-3xl font-bold">{money(price.amountMinor, price.currency)}</span>
					<span class="text-sm text-muted-foreground">
						/ {intervalLabel(price.interval, price.intervalCount)}</span
					>
				</p>
				<p class="mt-3 min-h-12 text-sm leading-6 text-muted-foreground">
					{planUseCase(label)}
				</p>
				<div class="mt-6 grid gap-2">
					<Button
						href={signedIn ? subscribeHref : loginHref}
						size="lg"
						class="bg-[var(--brand)] text-white hover:bg-[var(--brand)]/90"
						style={`--brand:${brand}`}>Start subscription</Button
					>
				</div>
			</div>
		{/each}
	</div>
{:else}
	<p class="rounded-xl border border-border p-4 text-sm leading-6 text-muted-foreground">
		Pricing is temporarily unavailable. Try again in a moment.
	</p>
{/if}

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { BillingPrice } from '$lib/domain/billing/contracts.js';

	let {
		pricing,
		trialAvailable,
		disabled = false,
		onselect,
		ontrial
	}: {
		pricing: readonly BillingPrice[];
		trialAvailable: boolean;
		disabled?: boolean;
		onselect: (priceId: string) => void;
		ontrial: (priceId: string) => void;
	} = $props();

	const money = (amount: number, currency: string): string =>
		new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency,
			maximumFractionDigits: amount % 100 === 0 ? 0 : 2
		}).format(amount / 100);
	const intervalLabel = (interval: BillingPrice['interval'], intervalCount: number): string =>
		intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;
	const label = (interval: BillingPrice['interval']): string =>
		interval === 'week' ? 'Weekly' : interval === 'month' ? 'Monthly' : 'Yearly';
	const useCase = (interval: BillingPrice['interval']): string =>
		interval === 'week'
			? 'Trying Maal without committing to a month.'
			: interval === 'year'
				? 'Households that already know meal planning is staying.'
				: 'The normal rhythm for shared meal planning.';
</script>

{#if pricing.length}
	<div class="grid gap-4 md:grid-cols-3">
		{#each pricing as price (price.id)}
			<div class="flex flex-col rounded-xl border border-border bg-card p-5">
				<div class="flex items-start justify-between gap-3">
					<h3 class="text-xl font-bold">{label(price.interval)}</h3>
					{#if price.interval === 'year'}
						<span
							class="rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-medium text-primary-foreground"
							>Best value</span
						>
					{/if}
				</div>
				<p class="mt-4">
					<span class="text-3xl font-bold tabular-nums"
						>{money(price.amountMinor, price.currency)}</span
					>
					<span class="text-sm text-muted-foreground">
						/ {intervalLabel(price.interval, price.intervalCount)}</span
					>
				</p>
				<p class="mt-3 min-h-12 text-sm leading-6 text-muted-foreground">
					{useCase(price.interval)}
				</p>
				<div class="mt-6 grid gap-2">
					{#if trialAvailable && price.interval === 'month'}
						<Button
							type="button"
							size="lg"
							class="w-full"
							{disabled}
							onclick={() => ontrial(price.id)}>Start trial</Button
						>
					{:else}
						<Button
							type="button"
							size="lg"
							class="w-full"
							{disabled}
							onclick={() => onselect(price.id)}>Start subscription</Button
						>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<p class="rounded-xl border border-border p-4 text-sm leading-6 text-muted-foreground">
		Pricing is temporarily unavailable. Try again in a moment.
	</p>
{/if}

<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';

	type Price = {
		id: string;
		label: string;
		amount: number;
		currency: string;
		interval: string;
		intervalCount: number;
	};

	let {
		pricing,
		trialAvailable = false,
		trialPriceId = null,
		signedIn = false,
		brand = '#fe7156'
	}: {
		pricing: Price[];
		trialAvailable?: boolean;
		trialPriceId?: string | null;
		signedIn?: boolean;
		brand?: string;
	} = $props();

	const money = (amount: number, currency: string): string =>
		new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency,
			maximumFractionDigits: amount % 100 === 0 ? 0 : 2
		}).format(amount / 100);

	const intervalLabel = (interval: string): string =>
		interval === 'week' ? 'week' : interval === 'year' ? 'year' : 'month';

	const planUseCase = (label: string): string => {
		if (label === 'Weekly') return 'Trying Maal without committing to a month.';
		if (label === 'Yearly') return 'Households that already know meal planning is staying.';
		return 'The normal rhythm for shared meal planning.';
	};

	const checkoutPath = (priceId: string, trialIntent = false): string => {
		const params = new URLSearchParams({ priceId });
		if (trialIntent) params.set('trial', '1');
		return resolve(`/billing/checkout?${params.toString()}`);
	};

	const checkoutHref = (priceId: string, trialIntent = false): string => {
		const path = checkoutPath(priceId, trialIntent);
		return signedIn ? path : resolve(`/auth/login?returnTo=${encodeURIComponent(path)}`);
	};

	const showTrialCta = $derived(Boolean(trialPriceId && (!signedIn || trialAvailable)));
	const ctaPriceId = (priceId: string): string =>
		showTrialCta && trialPriceId ? trialPriceId : priceId;

	const ctaLabel = $derived(showTrialCta ? 'Start trial' : 'Start subscription');
</script>

{#if pricing.length}
	<div class="grid gap-4 md:grid-cols-3">
		{#each pricing as price (price.id)}
			<div class="flex flex-col rounded-xl border border-border bg-card p-5">
				<div class="flex items-start justify-between gap-3">
					<h3 class="text-xl font-bold">{price.label}</h3>
					{#if price.label === 'Yearly'}
						<span
							class="rounded-full bg-[var(--brand)] px-2 py-0.5 text-[0.65rem] font-medium text-white"
							style={`--brand:${brand}`}>Best value</span
						>
					{/if}
				</div>
				<p class="mt-4">
					<span class="text-3xl font-bold">{money(price.amount, price.currency)}</span>
					<span class="text-sm text-muted-foreground"> / {intervalLabel(price.interval)}</span>
				</p>
				<p class="mt-3 min-h-12 text-sm leading-6 text-muted-foreground">
					{planUseCase(price.label)}
				</p>
				<div class="mt-6 grid gap-2">
					<Button
						href={checkoutHref(ctaPriceId(price.id), showTrialCta)}
						size="lg"
						class="bg-[var(--brand)] text-white hover:bg-[var(--brand)]/90"
						style={`--brand:${brand}`}>{ctaLabel}</Button
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

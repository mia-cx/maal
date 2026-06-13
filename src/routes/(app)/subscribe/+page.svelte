<script lang="ts">
	import PricingTable from '$lib/components/marketing/pricing-table.svelte';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import type { PageData } from './$types';

	const brand = '#fe7156';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Start subscription · Maal</title>
</svelte:head>

<section
	class="grid min-h-svh items-start justify-items-center overflow-y-auto bg-background px-4 py-12 text-foreground md:place-items-center md:py-16"
>
	<div class="mx-auto grid w-full max-w-5xl gap-10">
		<div class="grid justify-items-center gap-5 text-center">
			<WordmarkLogo class="h-8 w-auto" />
			<div class="grid gap-3">
				<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
					Choose a plan for {data.householdName}
				</h1>
				<p class="mx-auto max-w-2xl text-sm text-muted-foreground">
					This subscription applies only to {data.householdName}.
				</p>
			</div>
		</div>

		<PricingTable
			pricing={data.paidOptions}
			signedIn
			trialAvailable={data.trialAvailable && Boolean(data.trialOption)}
			trialPriceId={data.trialOption?.id ?? null}
			{brand}
		/>
	</div>
</section>

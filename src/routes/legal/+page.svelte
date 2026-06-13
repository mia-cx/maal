<script lang="ts">
	import MarketingShell from '$lib/components/marketing/marketing-shell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Legal · Maal</title>
	<meta name="description" content="Maal legal policies and archived policy versions." />
</svelte:head>

<MarketingShell>
	<section class="container mx-auto grid max-w-3xl gap-8 px-4 pt-28 pb-12 md:pt-32 md:pb-16">
		<header class="grid gap-3">
			<a href="/" class="text-sm font-medium text-muted-foreground hover:text-foreground"
				>← Back home</a
			>
			<h1 class="text-4xl font-bold tracking-tight">Legal</h1>
			<p class="text-muted-foreground">Current Maal policies and archived versions.</p>
		</header>

		<ul class="grid gap-3">
			{#each data.policies as policy}
				<li class="rounded-lg border border-border p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<a class="font-semibold underline" href={`/legal/${policy.slug}`}>{policy.title}</a>
							<p class="mt-1 text-sm text-muted-foreground">
								Effective {policy.current.effectiveDate}. {policy.current.summary}
							</p>
						</div>
						<a
							class="text-sm font-medium text-muted-foreground underline"
							href={`/legal/${policy.slug}/archive`}>Archive</a
						>
					</div>
				</li>
			{/each}
		</ul>
	</section>
</MarketingShell>

<script lang="ts">
	import MarketingShell from '$lib/components/marketing/marketing-shell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.policy.title} archive · Maal</title>
	<meta name="description" content={`Archived versions of the Maal ${data.policy.title}.`} />
</svelte:head>

<MarketingShell>
	<section class="container mx-auto grid max-w-3xl gap-8 px-4 pt-28 pb-12 md:pt-32 md:pb-16">
		<header class="grid gap-3">
			<nav class="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-muted-foreground">
				<a href="/" class="hover:text-foreground">← Back home</a>
				<a href="/legal" class="hover:text-foreground">Legal index</a>
				<a href={`/legal/${data.policy.slug}`} class="hover:text-foreground">Current version</a>
			</nav>
			<h1 class="text-4xl font-bold tracking-tight">{data.policy.title} archive</h1>
			<p class="text-muted-foreground">Current and archived versions of this policy.</p>
		</header>

		<ul class="grid gap-3">
			{#each data.policy.versions as version}
				<li class="rounded-lg border border-border p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<a
								class="font-semibold underline"
								href={`/legal/${version.policy}/${version.version}`}
							>
								{version.title} · {version.effectiveDate}
							</a>
							<p class="mt-1 text-sm text-muted-foreground">{version.summary}</p>
						</div>
						<span class="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
							{version.archived ? 'Archived' : 'Current'}
						</span>
					</div>
				</li>
			{/each}
		</ul>
	</section>
</MarketingShell>

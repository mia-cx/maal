<script lang="ts">
	import type { Component } from 'svelte';
	import MarketingShell from '$lib/components/marketing/marketing-shell.svelte';
	import type { LegalPolicyVersion } from '$lib/legal/types';

	let {
		document,
		content,
		archiveHref,
		currentHref
	}: {
		document: LegalPolicyVersion;
		content: Component;
		archiveHref: string;
		currentHref?: string;
	} = $props();

	let Content = $derived(content);
</script>

<MarketingShell>
	<article class="container mx-auto grid max-w-3xl gap-8 px-4 pt-28 pb-12 md:pt-32 md:pb-16">
		<header class="grid gap-3">
			<nav class="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-muted-foreground">
				<a href="/" class="hover:text-foreground">← Back home</a>
				<a href="/legal" class="hover:text-foreground">Legal index</a>
				<a href={archiveHref} class="hover:text-foreground">Archive</a>
			</nav>

			{#if document.archived && currentHref}
				<p class="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
					This is an archived version. <a
						class="font-medium text-foreground underline"
						href={currentHref}>View the current version.</a
					>
				</p>
			{/if}

			<h1 class="text-4xl font-bold tracking-tight">{document.title}</h1>
			<p class="text-sm text-muted-foreground">Effective {document.effectiveDate}</p>
		</header>

		<div class="legal-content">
			<Content />
		</div>
	</article>
</MarketingShell>

<style>
	.legal-content :global(*) {
		max-width: 100%;
	}

	.legal-content :global(h2) {
		margin-top: 2rem;
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.legal-content :global(h2:first-child) {
		margin-top: 0;
	}

	.legal-content :global(p) {
		margin-top: 0.75rem;
		line-height: 1.75;
		color: hsl(var(--muted-foreground));
	}

	.legal-content :global(ul) {
		margin-top: 0.75rem;
		list-style: disc;
		padding-left: 1.25rem;
		line-height: 1.75;
		color: hsl(var(--muted-foreground));
	}

	.legal-content :global(li + li) {
		margin-top: 0.5rem;
	}

	.legal-content :global(a) {
		font-weight: 500;
		color: hsl(var(--foreground));
		text-decoration: underline;
	}
</style>

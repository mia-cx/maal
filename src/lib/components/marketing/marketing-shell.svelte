<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import Anchor from './anchor.svelte';
	import Footer from './footer.svelte';
	import StickyHeader from './sticky-header.svelte';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import { Button } from '$lib/components/ui/button';

	let { children }: { children: Snippet } = $props();

	const brand = '#fe7156';
	const startPlanningHref = $derived(page.data.session ? resolve('/plan') : resolve('/auth/login'));
</script>

<div
	class="h-svh scroll-pt-28 overflow-x-clip overflow-y-auto overscroll-y-none scroll-smooth bg-background text-foreground"
>
	<div class="overflow-x-clip bg-background text-foreground">
		<StickyHeader>
			{#snippet logo()}
				<Anchor
					href={resolve('/')}
					aria-label="Maal home"
					showIcon={false}
					class="text-[var(--brand)] dark:text-foreground"
					style={`--brand:${brand}`}
				>
					<WordmarkLogo class="h-7 w-20" />
				</Anchor>
			{/snippet}
			{#snippet actions()}
				<nav class="hidden items-center gap-6 text-xs font-medium text-muted-foreground md:flex">
					<Anchor href={resolve('/#features')} showIcon={false}>Features</Anchor>
					<Anchor href={resolve('/#how-it-works')} showIcon={false}>How it Works</Anchor>
					<Anchor href={resolve('/#pricing')} showIcon={false}>Pricing</Anchor>
				</nav>
				<Button
					href={startPlanningHref}
					size="lg"
					class="bg-[var(--brand)] text-white hover:bg-[var(--brand)]/90"
					style={`--brand:${brand}`}>Start planning</Button
				>
			{/snippet}
		</StickyHeader>

		{@render children()}
		<Footer />
	</div>
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Anchor from '$lib/components/marketing/anchor.svelte';
	import Footer from '$lib/components/marketing/footer.svelte';
	import PricingTable from '$lib/components/marketing/pricing-table.svelte';
	import StickyHeader from '$lib/components/marketing/sticky-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import {
		Bookmark,
		Calendar,
		ClockCircle,
		Download,
		House,
		Key,
		ListCheck,
		Magnifier
	} from '@solar-icons/svelte/Outline';
	import type { PageData } from './$types';

	const brand = '#fe7156';
	const phrases = [
		'executive dysfunction',
		"people who can't meal plan",
		'tab-hoarders',
		'real life',
		'low spoons',
		'households with moving parts',
		'the 5PM food panic',
		'fridge-staring season',
		'people who live on backup meals',
		'imperfect weeks',
		'decision fatigue'
	];
	const loginHref = resolve('/auth/login');
	const features = [
		{
			icon: ClockCircle,
			text: 'Realistic cook time that learns from your actual pace, not recipe-site optimism.',
			highlight: true
		},
		{
			icon: Key,
			text: 'Authenticated MCP access so your favourite LLM can help manage the plan.',
			highlight: true
		},
		{
			icon: House,
			text: 'Household sharing for people planning from the same kitchen and schedule.',
			highlight: true
		},
		{
			icon: Calendar,
			text: 'Meals can be scheduled for a date and time, or left floating until later.'
		},
		{
			icon: Bookmark,
			text: 'Manage recipes you imported from external sources or added yourself.'
		},
		{
			icon: Magnifier,
			text: 'Search across recipe titles, sources, descriptions, and ingredients.'
		},
		{
			icon: ListCheck,
			text: 'Meal check-ins capture repeat, neutral, or avoid feedback after cooking.'
		},
		{ icon: Download, text: 'JSON export if you ever need to take your data elsewhere.' }
	];
	const howItWorks = [
		{
			title: 'Plan and schedule your meals.',
			text: 'Put meals on a specific date and time when the week is clear, or leave them floating when you only know “we should cook this soon.” The plan can start loose and become specific later.'
		},
		{
			title: 'Manage your recipes.',
			text: 'Import recipes from external sources when they publish structured data, or add your own. Maal keeps the recipes you actually use in one searchable menu.'
		},
		{
			title: 'Let your favourite LLMs manage your meal plan.',
			text: 'Maal exposes an authenticated MCP server with scoped keys, so assistants can list recipes, inspect planned meals, and help build a plan without needing your full account.'
		},
		{
			title: 'Adjust cook time to your pace.',
			text: 'After cooking, check in with what happened. Maal records your actual cook time and uses that signal as a cook-time coefficient, so future estimates move toward your kitchen instead of the recipe author’s best case.'
		}
	];

	let { data }: { data: PageData } = $props();
	const startPlanningHref = $derived(data.session ? resolve('/plan') : loginHref);
	let phraseIndex = $state(0);
	let typedPhrase = $state('');
	let timeout: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		let deleting = false;
		const tick = () => {
			const phrase = phrases[phraseIndex];
			if (!deleting && typedPhrase.length < phrase.length) {
				typedPhrase = phrase.slice(0, typedPhrase.length + 1);
				timeout = setTimeout(tick, 42);
				return;
			}
			if (!deleting) {
				deleting = true;
				timeout = setTimeout(tick, 4200);
				return;
			}
			if (typedPhrase.length > 0) {
				typedPhrase = typedPhrase.slice(0, -1);
				timeout = setTimeout(tick, 24);
				return;
			}
			deleting = false;
			phraseIndex = (phraseIndex + 1) % phrases.length;
			timeout = setTimeout(tick, 200);
		};
		tick();
		return () => {
			if (timeout) clearTimeout(timeout);
		};
	});
</script>

<svelte:head>
	<title>Maal · Flexible meal planning</title>
	<meta
		name="description"
		content="Maal is a personal recipe manager with a flexible meal schedule for real-life weeks."
	/>
</svelte:head>

<div
	class="h-svh scroll-pt-28 overflow-x-clip overflow-y-auto overscroll-none scroll-smooth bg-background text-foreground"
>
	<div class="overflow-x-clip bg-background text-foreground">
		<StickyHeader>
			{#snippet logo()}
				<Anchor
					href={resolve('/')}
					aria-label="Maal home"
					showIcon={false}
					class="text-[var(--brand)] hover:gap-2 dark:text-foreground"
					style={`--brand:${brand}`}
				>
					<WordmarkLogo class="h-7 w-20" />
				</Anchor>
			{/snippet}
			{#snippet actions()}
				<nav class="hidden items-center gap-6 text-xs font-medium text-muted-foreground md:flex">
					<Anchor href="#features" showIcon={false}>Features</Anchor>
					<Anchor href="#how-it-works" showIcon={false}>How it Works</Anchor>
					<Anchor href="#pricing" showIcon={false}>Pricing</Anchor>
				</nav>
				<Button
					href={startPlanningHref}
					size="lg"
					class="bg-[var(--brand)] text-white hover:bg-[var(--brand)]/90"
					style={`--brand:${brand}`}>Start planning</Button
				>
			{/snippet}
		</StickyHeader>

		<main>
			<section
				data-section="hero"
				class="mx-auto grid min-h-[calc(100svh-var(--marketing-header-height,4rem))] max-w-7xl items-center gap-8 overflow-visible px-4 py-16 md:grid-cols-[minmax(0,38rem)_minmax(0,1fr)] md:px-6 md:py-20"
			>
				<div class="flex min-w-0 flex-col justify-center">
					<h1
						class="min-h-[3.25em] max-w-2xl text-4xl leading-[1.08] font-bold tracking-tight md:text-5xl lg:text-6xl"
					>
						Meal planning built for <span class="text-[var(--brand)]" style={`--brand:${brand}`}
							>{typedPhrase}<span class="type-caret" aria-hidden="true"></span></span
						>
					</h1>
					<p
						class="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8"
					>
						Maal is a personal recipe manager with a flexible meal schedule. Import recipes, keep
						your own menu, and drag meals into your week when you’re ready.
					</p>
					<div class="mt-8 flex flex-wrap gap-3">
						<Button
							href={startPlanningHref}
							size="lg"
							class="h-10 bg-[var(--brand)] px-5 text-sm text-white hover:bg-[var(--brand)]/90"
							style={`--brand:${brand}`}>Start planning</Button
						>
						<Button
							href="#how-it-works"
							variant="outline"
							size="lg"
							class="h-10 border-border px-5 text-sm text-foreground hover:bg-muted hover:text-foreground"
							>How it works</Button
						>
					</div>
				</div>

				<div class="relative min-w-0">
					<div
						class="relative grid aspect-[16/9] w-full place-items-center overflow-hidden rounded-xl border border-border bg-card md:justify-self-end xl:w-[min(54rem,56vw)] xl:translate-x-[calc(33.333%+1.5rem)]"
					>
						<p class="relative max-w-xs text-center text-xs leading-5 text-muted-foreground">
							App screenshot placeholder
						</p>
					</div>
				</div>
			</section>

			<section id="features" class="scroll-mt-28 border-t border-border bg-muted/30">
				<div class="mx-auto max-w-7xl px-4 py-12 md:px-6">
					<h2 class="text-3xl font-bold md:text-4xl">Features</h2>
					<ul class="mt-6 space-y-3 text-base leading-7 text-muted-foreground">
						{#each features as feature}
							<li class="flex gap-3">
								<feature.icon
									class={feature.highlight
										? 'mt-1 size-4 text-[var(--brand)]'
										: 'mt-1 size-4 text-muted-foreground'}
									style={`--brand:${brand}`}
								/>
								<span>{feature.text}</span>
							</li>
						{/each}
					</ul>
					<p class="mt-6 text-base leading-7 text-muted-foreground">More coming soon.</p>
					<Anchor
						class="mt-2 cursor-default text-sm font-medium text-muted-foreground hover:gap-2 hover:text-muted-foreground"
						aria-disabled="true"
					>
						See all features
					</Anchor>
				</div>
			</section>

			<section
				id="how-it-works"
				class="mx-auto grid max-w-7xl scroll-mt-28 gap-12 overflow-visible px-4 py-14 md:px-6"
			>
				<div class="max-w-2xl">
					<h2 class="text-3xl font-bold md:text-4xl">How it works</h2>
					<p class="mt-3 text-base leading-7 text-muted-foreground">
						A meal plan should lower the cost of deciding what to eat, not become another fragile
						system to maintain.
					</p>
				</div>
				{#each howItWorks as step, index (step.title)}
					<div class="grid gap-6 md:grid-cols-3 md:items-start md:gap-10">
						<div class={index % 2 ? 'md:order-2 md:text-right' : 'md:text-left'}>
							<h3 class="text-2xl font-bold">{step.title}</h3>
							<p class="mt-3 text-base leading-7 text-muted-foreground">{step.text}</p>
						</div>
						<div
							class={[
								'rounded-xl border border-border bg-card p-3 md:col-span-2',
								index % 2 ? 'md:order-1' : ''
							].join(' ')}
						>
							<div
								class="grid aspect-[16/9] place-items-center rounded-lg bg-muted/30 text-xs text-muted-foreground"
							>
								Screenshot placeholder
							</div>
						</div>
					</div>
				{/each}
				<Anchor
					class="cursor-default text-sm font-medium text-muted-foreground hover:gap-2 hover:text-muted-foreground"
					aria-disabled="true"
				>
					Read more
				</Anchor>
			</section>

			<section id="pricing" class="scroll-mt-28 border-t border-border bg-muted/30">
				<div class="mx-auto grid max-w-7xl gap-8 px-4 py-14 md:px-6">
					<div class="max-w-2xl">
						<h2 class="text-3xl font-bold md:text-4xl">Pricing</h2>
						<p class="mt-3 text-base leading-7 text-muted-foreground">Subscribe per household.</p>
					</div>

					{#if data.pricingStatus === 'unavailable'}
						<p
							class="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-destructive"
						>
							Pricing is temporarily unavailable because billing data could not be loaded. Try again
							in a moment.
						</p>
					{:else}
						<PricingTable
							pricing={data.pricing}
							signedIn={Boolean(data.session)}
							trialAvailable={data.trialAvailable}
							trialPriceId={data.trialPriceId}
							{brand}
						/>
					{/if}
				</div>
			</section>
		</main>
		<Footer />
	</div>
</div>

<style>
	.type-caret {
		display: inline-block;
		width: 0.08em;
		height: 0.82em;
		margin-left: 0.08em;
		background: currentColor;
		animation: blink 1s steps(2, start) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>

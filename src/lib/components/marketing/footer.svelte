<script lang="ts">
	import { resolve } from '$app/paths';
	import Anchor from '$lib/components/marketing/anchor.svelte';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import GithubIcon from '@lucide/svelte/icons/github';

	const year = new Date().getFullYear();
	const landingHref = (fragment: string) => `${resolve('/')}${fragment}`;
</script>

<footer class="border-t border-border py-14 md:py-16">
	<div class="mx-auto grid max-w-7xl grid-cols-1 items-start gap-4 px-4 md:grid-cols-4 md:px-6">
		<section class="flex h-full flex-col justify-between md:col-span-2">
			<div class="grid justify-items-start gap-4">
				<WordmarkLogo class="h-10 w-auto" />
				<Anchor
					class="gap-0.5 font-bold text-muted-foreground"
					href="https://github.com/mia-cx/maal"
				>
					Contribute to Maal
				</Anchor>
			</div>
			<div class="mt-4 flex flex-wrap items-center gap-8">
				<ul class="flex gap-4">
					<li>
						<Anchor
							class="inline-flex size-9 items-center justify-center text-muted-foreground md:size-7"
							href="https://github.com/mia-cx/maal"
							aria-label="Maal on GitHub"
							showIcon={false}
						>
							<GithubIcon class="block size-6 md:size-5" />
						</Anchor>
					</li>
				</ul>

				<ul class="flex gap-4">
					<li>
						<Anchor class="text-muted-foreground" href="mailto:maal@mia.cx">
							<span class="hidden text-base lg:inline">maal@mia.cx</span>
						</Anchor>
					</li>
				</ul>
			</div>
		</section>

		<section>
			<h2 class="font-semibold">Sitemap</h2>
			<ul class="mt-2 space-y-1 text-muted-foreground">
				<li>
					<Anchor href={resolve('/')}>Home</Anchor>
				</li>
				<li>
					<Anchor href={landingHref('#features')}>Features</Anchor>
				</li>
				<li>
					<Anchor href={landingHref('#how-it-works')}>How it works</Anchor>
				</li>
				<li>
					<Anchor href={landingHref('#pricing')}>Pricing</Anchor>
				</li>
			</ul>
		</section>

		<section>
			<h2 class="font-semibold">Support</h2>
			<p class="mt-2 text-muted-foreground">
				Maal<br />
				<Anchor href="mailto:maal@mia.cx">maal@mia.cx</Anchor><br />
			</p>
		</section>

		<div class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground md:col-span-4">
			<span>© {year} Maal</span>
			<Anchor href={resolve('/legal/privacy')} showIcon={false}>Privacy Policy</Anchor>
			<Anchor href={resolve('/legal/terms')} showIcon={false}>Terms of Use</Anchor>
			<Anchor href={resolve('/legal/cookies')} showIcon={false}>Cookie Policy</Anchor>
		</div>
	</div>
</footer>

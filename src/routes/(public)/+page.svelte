<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowDown, ArrowRight, Bookmark, CalendarDays, Sparkles, WifiOff } from '@lucide/svelte';
	import PublicHead from '$lib/components/public-head.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { alternatesFor, canonicalOrigin } from '$lib/public-site';

	const languages = {
		en: 'English',
		nl: 'Nederlands',
		de: 'Deutsch',
		sv: 'Svenska',
		da: 'Dansk',
		no: 'Norsk',
		es: 'Español',
		fr: 'Français',
		it: 'Italiano',
		pt: 'Português'
	};
	const locale = getLocale();
	const alternates = alternatesFor('/');
	const canonical = alternates.find((alternate) => alternate.locale === locale)!.url;
	const title = m.landing_title();
	const description = m.landing_description();
	const organization = `${canonicalOrigin}/#organization`;
	const structuredData = {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'Organization',
				'@id': organization,
				name: 'Maal',
				url: canonicalOrigin,
				logo: `${canonicalOrigin}/icon-512.png`
			},
			{
				'@type': 'SoftwareApplication',
				name: 'Maal',
				url: canonical,
				inLanguage: locale,
				description,
				applicationCategory: 'LifestyleApplication',
				operatingSystem: 'Web',
				publisher: { '@id': organization },
				offers: { '@type': 'Offer', name: m.landing_local_title(), price: 0, url: canonical }
			}
		]
	};
</script>

<PublicHead {title} {description} {canonical} {alternates} {structuredData} />

<div class="landing">
	<header class="frame masthead">
		<div class="brand">
			<img src="/favicon.svg" alt="" width="32" height="32" />
			Maal
		</div>
		<a class="button outline" href={resolve('/plan')} data-sveltekit-reload>
			{m.landing_open()}
			<ArrowRight size={16} aria-hidden="true" />
		</a>
	</header>

	<main>
		<section class="frame hero">
			<div class="intro">
				<p class="eyebrow">{m.landing_label()}</p>
				<h1>{m.landing_headline()}</h1>
				<p class="lead">{m.landing_intro()}</p>
				<div class="actions">
					<a class="button solid" href={resolve('/plan')} data-sveltekit-reload>
						{m.landing_open()}
						<ArrowRight size={18} aria-hidden="true" />
					</a>
					<a class="text-link" href="#pricing">
						{m.landing_pricing()}
						<ArrowDown size={15} aria-hidden="true" />
					</a>
				</div>
			</div>

			<figure class="illustration">
				<div class="pool">
					<p class="card-label"><Bookmark size={19} aria-hidden="true" /> {m.landing_pool()}</p>
					<div class="meal yellow">{m.landing_meal_two()}</div>
					<div class="meal green">{m.landing_meal_three()}</div>
				</div>
				<div class="week">
					<p class="card-label"><CalendarDays size={19} aria-hidden="true" /> {m.landing_week()}</p>
					<div class="day">
						<span>{m.landing_monday()}</span><span class="empty" aria-hidden="true"></span>
					</div>
					<div class="day">
						<span>{m.landing_tuesday()}</span><span class="meal pink">{m.landing_meal_one()}</span>
					</div>
					<div class="day">
						<span>{m.landing_wednesday()}</span><span class="empty" aria-hidden="true"></span>
					</div>
				</div>
				<figcaption>{m.landing_example()}</figcaption>
			</figure>
		</section>

		<section class="details" id="pricing">
			<div class="frame">
				<h2>{m.landing_pricing_headline()}</h2>
				<div class="plans">
					<div>
						<WifiOff size={26} aria-hidden="true" />
						<h3>{m.landing_local_title()}</h3>
						<p>{m.landing_local_body()}</p>
					</div>
					<div>
						<Sparkles size={26} aria-hidden="true" />
						<h3>{m.landing_sync_title()}</h3>
						<p>{m.landing_sync_body()}</p>
					</div>
				</div>
			</div>
		</section>
	</main>

	<footer class="frame footer">
		<p>Maal</p>
		<nav aria-label={m.landing_languages()}>
			{#each alternates as { locale: language, href } (language)}
				{#if language !== 'x-default'}
					<a
						href={resolve(href as '/')}
						lang={language}
						hreflang={language}
						aria-current={language === locale ? 'page' : undefined}
						data-sveltekit-reload
					>
						{languages[language]}
					</a>
				{/if}
			{/each}
		</nav>
	</footer>
</div>

<style>
	:global(html):has(.landing),
	:global(body):has(.landing) {
		height: auto;
		overflow: visible;
	}

	.landing {
		--ink: #2b1b17;
		--muted: #624c44;
		--paper: #fff8ef;
		--line: #e4cec2;
		background: var(--paper);
		color: var(--ink);
		min-height: 100vh;
		font-family: 'Inter Variable', sans-serif;
	}

	.frame {
		width: min(100% - 3rem, 74rem);
		margin-inline: auto;
	}
	.masthead,
	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.masthead {
		padding-block: 1.5rem;
		border-bottom: 1px solid var(--line);
	}
	.brand,
	.footer p {
		font:
			700 1.7rem / 1 'Lexend',
			sans-serif;
	}
	.brand,
	.button,
	.text-link {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}
	.button {
		text-decoration: none;
	}
	.button {
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--ink);
		border-radius: 0.65rem;
		font-size: 0.92rem;
		font-weight: 700;
		line-height: 1.25;
	}
	.button :global(svg),
	.text-link :global(svg) {
		flex-shrink: 0;
	}
	.outline:hover,
	.outline:focus-visible {
		background: #fce9de;
	}
	.solid {
		background: var(--ink);
		color: #fff8ef;
	}
	.solid:hover,
	.solid:focus-visible {
		background: #543328;
	}
	.text-link {
		min-height: 2.75rem;
		text-decoration: underline;
		text-underline-offset: 0.25em;
		font-weight: 650;
	}

	.hero {
		display: grid;
		align-items: center;
		grid-template-columns: 1fr 1fr;
		gap: clamp(2rem, 5vw, 5rem);
		padding-block: clamp(3rem, 6vw, 6rem);
	}
	.eyebrow {
		display: inline-block;
		border-radius: 2rem;
		padding: 0.4rem 0.75rem;
		background: #f9dbc9;
		font-size: 0.78rem;
		font-weight: 750;
	}
	h1,
	h2 {
		font-family: 'Nunito Sans Variable', sans-serif;
		font-weight: 900;
		letter-spacing: -0.06em;
		text-wrap: balance;
	}
	h1 {
		margin-block: 0.9rem 1.2rem;
		font-size: clamp(2.75rem, 5vw, 5.1rem);
		line-height: 0.99;
	}
	h2 {
		font-size: clamp(2rem, 4vw, 3.6rem);
		line-height: 1.05;
	}
	.lead {
		color: var(--muted);
		max-width: 38ch;
		font-size: clamp(1rem, 2vw, 1.2rem);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1.3rem;
		margin-top: 1.65rem;
	}

	.illustration {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1.1fr;
		align-items: center;
		gap: 1rem;
		padding: 2rem 1.3rem 1.2rem;
		min-width: 0;
		border: 1px solid #e4a890;
		border-radius: 1.5rem;
		background: radial-gradient(circle at 15% 10%, #fff1d8, transparent 65%), #f9bfa7;
	}
	.pool,
	.week {
		min-width: 0;
		border: 1px solid #bc8d7a;
		border-radius: 0.9rem;
		padding: 0.75rem;
		background: #fffaf4;
		box-shadow: 0 6px 0 #723a2418;
	}
	.pool {
		transform: rotate(-4deg);
	}
	.week {
		transform: rotate(4deg);
	}
	.card-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.65rem;
		font-weight: 800;
		font-size: 0.9rem;
	}
	.card-label :global(svg) {
		flex-shrink: 0;
	}
	.meal {
		border-radius: 0.45rem;
		padding: 0.44rem 0.55rem;
		font-size: 0.78rem;
		font-weight: 675;
		line-height: 1.23;
		overflow-wrap: anywhere;
	}
	.pool .meal + .meal {
		margin-top: 0.42rem;
	}
	.pink {
		background: #f9d9d1;
	}
	.yellow {
		background: #f6e5b8;
	}
	.green {
		background: #deebd4;
	}
	.day {
		display: grid;
		gap: 0.24rem;
		padding: 0.36rem 0;
		border-top: 1px solid #ebded2;
		font-size: 0.75rem;
		font-weight: 650;
	}
	.empty {
		height: 0.6rem;
		border: 1px dashed #d9bcaf;
		border-radius: 0.25rem;
	}
	figcaption {
		grid-column: 1 / -1;
		color: #56382f;
		font-size: 0.8rem;
		text-align: center;
	}

	.details {
		padding-block: clamp(2.5rem, 5vw, 4.5rem);
		border-block: 1px solid var(--line);
		background: #faeadd;
	}
	.plans {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.9rem;
		margin-top: 1.6rem;
	}
	.plans > div {
		padding: clamp(1.1rem, 3vw, 1.8rem);
		border: 1px solid var(--line);
		border-radius: 1rem;
		background: var(--paper);
	}
	.plans h3 {
		margin-block: 0.55rem 0.3rem;
		font-size: 1.15rem;
		font-weight: 780;
	}
	.plans p {
		color: var(--muted);
		max-width: 47ch;
	}
	.footer {
		flex-wrap: wrap;
		padding-block: 1.5rem;
	}
	.footer p {
		font-size: 1.1rem;
	}
	.footer nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.8rem;
		font-size: 0.83rem;
		color: var(--muted);
	}
	.footer a {
		display: inline-flex;
		align-items: center;
		min-height: 1.6rem;
	}
	.footer a[aria-current],
	.footer a:hover {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	@media (max-width: 47rem) {
		.frame {
			width: calc(100% - 2rem);
		}
		.masthead {
			padding-block: 0.9rem;
		}
		.hero,
		.plans {
			grid-template-columns: 1fr;
		}
		.hero {
			padding-block: 2.6rem 2.25rem;
		}
		.illustration {
			padding: 1.25rem 0.8rem 0.8rem;
			gap: 0.7rem;
		}
		.pool,
		.week {
			padding: 0.55rem;
		}
	}
</style>

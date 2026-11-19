<script lang="ts">
	import { canonicalOrigin } from '$lib/public-site';

	let {
		title,
		description,
		canonical,
		alternates,
		structuredData
	}: {
		title: string;
		description: string;
		canonical: string;
		alternates: readonly { locale: string; url: string }[];
		structuredData: object;
	} = $props();

	const image = `${canonicalOrigin}/social.png`;
	const jsonLd = $derived(
		`<script type="application/ld+json">${JSON.stringify(structuredData).replaceAll('<', '\\u003c')}</` +
			'script>'
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	{#each alternates as { locale, url } (locale)}
		<link rel="alternate" hreflang={locale} href={url} />
	{/each}
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Maal" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={image} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Maal" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={image} />
	<meta name="twitter:image:alt" content="Maal" />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-encoded data escapes every opening bracket -->
	{@html jsonLd}
</svelte:head>

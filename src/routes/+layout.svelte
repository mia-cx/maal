<script lang="ts">
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ModeWatcher } from 'mode-watcher';
	import type { Snippet } from 'svelte';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import AuthCallbackProjector from '$lib/components/auth-callback-projector.svelte';
	import PwaUpdatePrompt from '$lib/components/pwa-update-prompt.svelte';
	import './layout.css';

	let { children }: { children: Snippet } = $props();
	const resolvePathname = resolve as unknown as (pathname: Pathname) => string;

	let faviconHref = $state('/favicon.svg');

	$effect(() => {
		const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
		const updateFavicon = () => {
			faviconHref = `/favicon.svg?scheme=${colorScheme.matches ? 'dark' : 'light'}`;
		};

		updateFavicon();
		colorScheme.addEventListener('change', updateFavicon);
		return () => colorScheme.removeEventListener('change', updateFavicon);
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={faviconHref} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#fe7156" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-title" content="Maal" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
</svelte:head>
<ModeWatcher />
<AuthCallbackProjector />
<PwaUpdatePrompt />

{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- localizeHref returns a generated localized pathname -->
		<a href={resolvePathname(localizeHref(page.url.pathname, { locale }) as Pathname)}>{locale}</a>
	{/each}
</div>

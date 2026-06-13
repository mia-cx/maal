<script lang="ts">
	import { page } from '$app/state';
	import { ModeWatcher } from 'mode-watcher';
	import type { Snippet } from 'svelte';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import './layout.css';

	let { children }: { children: Snippet } = $props();

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

<svelte:head><link rel="icon" type="image/svg+xml" href={faviconHref} /></svelte:head>
<ModeWatcher />

{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={localizeHref(page.url.pathname, { locale })}>{locale}</a>
	{/each}
</div>

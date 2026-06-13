<script lang="ts">
	import LegalShell from '$lib/components/legal/legal-shell.svelte';
	import { getPolicyComponent } from '$lib/legal/policies';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let content = $derived(getPolicyComponent(data.document.policy, data.document.version));
</script>

<svelte:head>
	<title>{data.document.title} · {data.document.effectiveDate} · Maal</title>
	<meta name="description" content={data.document.description} />
</svelte:head>

{#if content}
	<LegalShell
		document={data.document}
		{content}
		archiveHref={data.archiveHref}
		currentHref={data.currentHref}
	/>
{/if}

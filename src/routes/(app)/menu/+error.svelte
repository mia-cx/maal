<script lang="ts">
	import { page } from '$app/state';
	import * as Button from '$lib/components/ui/button';

	const message = $derived(
		page.error?.message ?? 'We could not load your menu. Try again in a moment.'
	);
</script>

<svelte:head>
	<title>Menu unavailable • Maal</title>
</svelte:head>

<section class="mx-auto grid min-h-[50vh] max-w-xl place-items-center px-6 py-16 text-center">
	<div class="grid gap-4">
		<p class="text-sm font-medium text-muted-foreground">Menu unavailable</p>
		<h1 class="text-3xl font-semibold tracking-tight">Could not load your menu</h1>
		<p class="text-muted-foreground">{message}</p>
		<div>
			<Button.Root href="/menu">Try again</Button.Root>
		</div>
	</div>
</section>

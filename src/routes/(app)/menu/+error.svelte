<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import * as Button from '$lib/components/ui/button';

	const message = $derived(page.error?.message ?? m.menu_could_not_load_menu_try_again());
</script>

<svelte:head>
	<title>{m.menu_menu_unavailable_maal()}</title>
</svelte:head>

<section class="mx-auto grid min-h-[50vh] max-w-xl place-items-center px-6 py-16 text-center">
	<div class="grid gap-4">
		<p class="text-sm font-medium text-muted-foreground">{m.menu_menu_unavailable()}</p>
		<h1 class="text-3xl font-semibold tracking-tight">{m.menu_could_not_load_your_menu()}</h1>
		<p class="text-muted-foreground">{message}</p>
		<div>
			<Button.Root href="/menu">{m.menu_try_again()}</Button.Root>
		</div>
	</div>
</section>

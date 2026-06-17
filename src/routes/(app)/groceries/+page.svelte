<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.app_grocery_rollup_maal()}</title>
</svelte:head>

<section class="flex h-svh min-w-0 flex-col bg-background text-foreground">
	<header class="border-b border-border px-6 py-4">
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
			{m.app_preview()}
		</p>
		<h1 class="mt-1 text-2xl font-semibold tracking-tight">{m.app_grocery_rollup()}</h1>
	</header>
	<main class="grid flex-1 place-items-center p-6">
		<div class="max-w-md rounded-xl border border-border bg-card/60 p-6 text-center shadow-sm">
			<h2 class="text-lg font-semibold">{m.app_grocery_rollup_is_enabled_for_your_account()}</h2>
			<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
				{m.app_this_feature_flag_is_wired_up_the_grocery_ro()}
				<code class="rounded bg-muted px-1 py-0.5">grocery-rollup</code>
				{m.app_workos_flag()}
			</p>
		</div>
	</main>
</section>

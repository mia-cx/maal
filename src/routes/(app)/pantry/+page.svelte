<svelte:head>
	<title>Pantry · Maal</title>
</svelte:head>

<section class="flex h-svh min-w-0 flex-col bg-background text-foreground">
	<header class="border-b border-border px-6 py-4">
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Preview</p>
		<h1 class="mt-1 text-2xl font-semibold tracking-tight">Pantry</h1>
	</header>
	<main class="grid flex-1 place-items-center p-6">
		<div class="max-w-md rounded-xl border border-border bg-card/60 p-6 text-center shadow-sm">
			<h2 class="text-lg font-semibold">Pantry is enabled for your account</h2>
			<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
				This feature flag is wired up. The pantry workflow can now ship behind the
				<code class="rounded bg-muted px-1 py-0.5">pantry</code> WorkOS flag.
			</p>
		</div>
	</main>
</section>

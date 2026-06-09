<script lang="ts">
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const homeHref = resolve('/' as Pathname);
	const loginHref = resolve('/auth/login' as Pathname);
	const logoutHref = resolve('/auth/logout' as Pathname);
	const displayName = $derived(data.session?.user.name ?? data.session?.user.email ?? 'there');
</script>

<svelte:head>
	<title>Maal</title>
	<meta
		name="description"
		content="Maal turns the recipes you already trust into a household meal rhythm."
	/>
</svelte:head>

<main class="min-h-screen bg-stone-50 text-stone-950">
	<section class="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
		<nav class="flex items-center justify-between">
			<a href={homeHref} class="text-xl font-black tracking-tight">Maal</a>
			{#if data.session}
				<a
					href={logoutHref}
					class="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold transition hover:border-stone-950"
				>
					Sign out
				</a>
			{:else}
				<a
					href={loginHref}
					class="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
				>
					Sign in
				</a>
			{/if}
		</nav>

		<div class="grid flex-1 items-center gap-10 py-20 md:grid-cols-[1.1fr_0.9fr]">
			<div class="space-y-8">
				<p class="text-sm font-bold tracking-[0.3em] text-amber-700 uppercase">
					Dinner memory, not recipe discovery
				</p>
				<div class="space-y-5">
					<h1 class="max-w-3xl text-5xl font-black tracking-tight text-balance md:text-7xl">
						Make the recipes you already trust easier to repeat.
					</h1>
					<p class="max-w-2xl text-lg leading-8 text-stone-700">
						Maal keeps your household's menu, staples, taste rules, and post-meal memory close
						enough for Poke to plan from real life.
					</p>
				</div>

				{#if data.session}
					<div class="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
						<p class="text-sm font-semibold tracking-[0.2em] text-emerald-700 uppercase">
							Signed in
						</p>
						<p class="mt-2 text-2xl font-black">Welcome back, {displayName}.</p>
						<p class="mt-2 text-sm text-emerald-800">
							WorkOS session active{data.session.organizationId
								? ` for household ${data.session.organizationId}`
								: ''}.
						</p>
					</div>
				{:else}
					<div class="flex flex-wrap gap-3">
						<a
							href={loginHref}
							class="rounded-full bg-amber-500 px-6 py-3 font-black text-amber-950 shadow-[0_10px_0_#78350f] transition hover:-translate-y-0.5 hover:shadow-[0_12px_0_#78350f]"
						>
							Start with AuthKit
						</a>
						<a
							href={resolve('/auth/login?screen_hint=sign-up' as Pathname)}
							class="rounded-full border-2 border-stone-950 px-6 py-3 font-black transition hover:bg-stone-950 hover:text-white"
						>
							Create account
						</a>
					</div>
				{/if}
			</div>

			<div
				class="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-2xl shadow-stone-200/70"
			>
				<div class="space-y-4 rounded-[1.5rem] bg-stone-950 p-5 text-white">
					<p class="text-sm font-bold tracking-[0.25em] text-amber-300 uppercase">
						v0.1 foundation
					</p>
					<ul class="space-y-3 text-sm leading-6 text-stone-200">
						<li>• WorkOS owns users, orgs, memberships, and sessions.</li>
						<li>• Maal stores WorkOS IDs on recipe and household records.</li>
						<li>• Redirect URLs come from the request origin.</li>
						<li>• Stripe entitlements can arrive through WorkOS tokens later.</li>
					</ul>
				</div>
			</div>
		</div>
	</section>
</main>

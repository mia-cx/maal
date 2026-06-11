<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import {
		appendMenuRecipes,
		deleteMenuRecipe,
		hydrateMenuRecipes,
		menuRecipesStore,
		selectMenuRecipe,
		selectedMenuRecipeStore,
		updateMenuRecipe
	} from '$lib/stores/menu-recipes';
	import MyMenuRecipeSheet from './recipe-edit-sheet.svelte';
	import RecipeMenuCard from './recipe-menu-card.svelte';
	import type { RecipeMenuItem } from './menu-types';

	let {
		recipes: initialRecipes = [],
		nextRecipeOffset: initialNextRecipeOffset = null
	}: { recipes?: RecipeMenuItem[]; nextRecipeOffset?: number | null } = $props();

	let sheetOpen = $state(false);
	let hydratedRecipesSignature = $state('');
	let nextRecipeOffset = $state<number | null>(null);
	let recipesLoading = $state(false);
	let recipesLoadError = $state<string | null>(null);
	let loadMoreElement = $state<HTMLElement>();

	const recipes = $derived($menuRecipesStore);
	const selectedRecipe = $derived($selectedMenuRecipeStore);

	$effect(() => {
		const signature = initialRecipes.map((recipe) => recipe.id).join('|');
		if (signature === hydratedRecipesSignature) return;
		hydratedRecipesSignature = signature;
		nextRecipeOffset = initialNextRecipeOffset;
		hydrateMenuRecipes(initialRecipes);
	});

	const loadMoreRecipes = async () => {
		if (nextRecipeOffset === null || recipesLoading) return;
		recipesLoading = true;
		recipesLoadError = null;
		const response = await fetch(
			resolve(`/menu/recipes?offset=${nextRecipeOffset}&limit=24` as Pathname)
		);
		recipesLoading = false;
		if (!response.ok) {
			recipesLoadError = 'Could not load more recipes.';
			return;
		}
		const body = (await response.json()) as {
			recipes: RecipeMenuItem[];
			nextRecipeOffset: number | null;
		};
		appendMenuRecipes(body.recipes);
		nextRecipeOffset = body.nextRecipeOffset;
	};

	$effect(() => {
		if (!loadMoreElement || nextRecipeOffset === null) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadMoreRecipes();
			},
			{ rootMargin: '480px 0px' }
		);
		observer.observe(loadMoreElement);
		return () => observer.disconnect();
	});

	const openRecipe = (recipe: RecipeMenuItem) => {
		selectMenuRecipe(recipe.id);
		sheetOpen = true;
	};
</script>

<svelte:head>
	<title>My Menu · Maal</title>
</svelte:head>

<section class="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
	<header
		class="sticky top-0 z-40 flex h-[52px] shrink-0 items-center border-b border-border bg-background px-2"
	>
		<div class="flex shrink-0 items-center gap-2 text-foreground">
			<div class="flex w-9 shrink-0 items-center justify-center">
				<Sidebar.Trigger />
			</div>
			<WordmarkLogo class="h-5 w-16" />
		</div>
	</header>

	<div class="@container/my-menu-main min-h-0 flex-1 overflow-auto p-3 md:p-4">
		<div
			class="grid grid-cols-1 gap-3 md:gap-4 @min-[42rem]/my-menu-main:grid-cols-2 @min-[64rem]/my-menu-main:grid-cols-3 @min-[86rem]/my-menu-main:grid-cols-4"
		>
			{#each recipes as recipe (recipe.id)}
				<RecipeMenuCard {recipe} onselect={openRecipe} />
			{/each}
		</div>
		<div bind:this={loadMoreElement} class="flex min-h-10 items-center justify-center py-4">
			{#if recipesLoading}
				<p class="text-xs text-muted-foreground">Loading recipes…</p>
			{:else if recipesLoadError}
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
					onclick={loadMoreRecipes}
				>
					{recipesLoadError}
				</button>
			{/if}
		</div>
	</div>
</section>

<MyMenuRecipeSheet
	bind:open={sheetOpen}
	recipe={selectedRecipe}
	onsaved={updateMenuRecipe}
	ondeleted={deleteMenuRecipe}
/>

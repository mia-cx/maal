<script lang="ts">
	import { MyMenuDashboard, type RecipeMenuItem } from '$lib/components/menu';
	import { activeHouseholdId } from '$lib/stores/active-household';
	import { getCachedMenuRouteData, setCachedMenuRouteData } from '$lib/stores/route-data-cache';
	import { onDestroy, onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let recipes = $state<RecipeMenuItem[]>([]);
	let archivedRecipes = $state<RecipeMenuItem[]>([]);
	let nextRecipeOffset = $state<number | null>(null);
	let unsubscribeActiveHousehold: (() => void) | null = null;

	$effect(() => {
		void Promise.all([
			Promise.resolve(data.recipes),
			Promise.resolve(data.archivedRecipes),
			Promise.resolve(data.nextRecipeOffset)
		]).then(([resolvedRecipes, resolvedArchivedRecipes, resolvedNextRecipeOffset]) => {
			recipes = resolvedRecipes ?? [];
			archivedRecipes = resolvedArchivedRecipes ?? [];
			nextRecipeOffset = resolvedNextRecipeOffset ?? null;
			setCachedMenuRouteData(data.activeHouseholdId, {
				recipes,
				archivedRecipes,
				nextRecipeOffset
			});
		});
	});

	onMount(() => {
		const cached = getCachedMenuRouteData(data.activeHouseholdId);
		if (cached) {
			recipes = cached.recipes;
			archivedRecipes = cached.archivedRecipes;
			nextRecipeOffset = cached.nextRecipeOffset;
		}

		unsubscribeActiveHousehold = activeHouseholdId.subscribe((householdId) => {
			if (householdId && householdId !== data.activeHouseholdId) {
				const cached = getCachedMenuRouteData(householdId);
				recipes = cached?.recipes ?? [];
				archivedRecipes = cached?.archivedRecipes ?? [];
				nextRecipeOffset = cached?.nextRecipeOffset ?? null;
			}
		});
	});
	onDestroy(() => unsubscribeActiveHousehold?.());
</script>

<MyMenuDashboard {recipes} {archivedRecipes} {nextRecipeOffset} />

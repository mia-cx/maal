<script lang="ts">
	import { MyMenuDashboard, type RecipeMenuItem } from '$lib/components/menu';
	import { activeHouseholdId, writeActiveHouseholdCookie } from '$lib/stores/active-household';
	import {
		clearMenuRouteDataCache,
		getCachedMenuRouteData,
		setCachedMenuRouteData
	} from '$lib/stores/route-data-cache';
	import { onDestroy, onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let recipes = $state<RecipeMenuItem[]>([]);
	let archivedRecipes = $state<RecipeMenuItem[]>([]);
	let nextRecipeOffset = $state<number | null>(null);
	let unsubscribeActiveHousehold: (() => void) | null = null;

	$effect(() => {
		const routeRecipes = data.recipes ?? [];
		const routeArchivedRecipes = data.archivedRecipes ?? [];
		const routeNextRecipeOffset = data.nextRecipeOffset ?? null;

		recipes = routeRecipes;
		archivedRecipes = routeArchivedRecipes;
		nextRecipeOffset = routeNextRecipeOffset;
		setCachedMenuRouteData(data.activeHouseholdId, {
			recipes: routeRecipes,
			archivedRecipes: routeArchivedRecipes,
			nextRecipeOffset: routeNextRecipeOffset
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
			if (!householdId) {
				clearMenuRouteDataCache();
				writeActiveHouseholdCookie(null);
				recipes = [];
				archivedRecipes = [];
				nextRecipeOffset = null;
				return;
			}
			if (householdId !== data.activeHouseholdId) {
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

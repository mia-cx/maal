<script lang="ts">
	import { householdIsAccessible } from '$lib/client-db/context';
	import { readRecipesFromDexie } from '$lib/client-db/repositories';
	import { MyMenuDashboard, type RecipeMenuItem } from '$lib/components/menu';
	import { activeHouseholdId, writeActiveHouseholdCookie } from '$lib/stores/active-household';
	import {
		clearUserRouteDataCache,
		getCachedMenuRouteData,
		setCachedMenuRouteData
	} from '$lib/stores/route-data-cache';
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let recipes = $state<RecipeMenuItem[]>(untrack(() => data.recipes ?? []));
	let archivedRecipes = $state<RecipeMenuItem[]>(untrack(() => data.archivedRecipes ?? []));
	let nextRecipeOffset = $state<number | null>(untrack(() => data.nextRecipeOffset ?? null));
	let cacheHydrationVersion = 0;
	let unsubscribeActiveHousehold: (() => void) | null = null;

	const cacheScope = (householdId: string | null | undefined = data.activeHouseholdId) =>
		data.session?.user.id && householdId ? { userId: data.session.user.id, householdId } : null;
	const canReadHouseholdCache = (householdId: string | null | undefined) =>
		householdIsAccessible(data.households, householdId);

	const hydrateCachedMenu = async (
		householdId: string | null | undefined,
		clearWhenMissing = false
	) => {
		if (!canReadHouseholdCache(householdId)) return;
		const version = ++cacheHydrationVersion;
		const scope = cacheScope(householdId);
		const [cached, recipeCache] = await Promise.all([
			getCachedMenuRouteData(scope),
			readRecipesFromDexie(scope)
		]);
		const hasRecipeCache = Boolean(
			recipeCache.recipes.length || recipeCache.archivedRecipes.length
		);
		if (version !== cacheHydrationVersion || (!cached && !hasRecipeCache && !clearWhenMissing))
			return;
		recipes = recipeCache.recipes;
		archivedRecipes = recipeCache.archivedRecipes;
		nextRecipeOffset = cached?.nextRecipeOffset ?? null;
	};

	$effect(() => {
		const routeRecipes = data.recipes ?? [];
		const routeArchivedRecipes = data.archivedRecipes ?? [];
		const routeNextRecipeOffset = data.nextRecipeOffset ?? null;

		if (!routeRecipes.length && !routeArchivedRecipes.length) return;
		recipes = routeRecipes;
		archivedRecipes = routeArchivedRecipes;
		nextRecipeOffset = routeNextRecipeOffset;
		void setCachedMenuRouteData(cacheScope(), {
			recipes: routeRecipes,
			archivedRecipes: routeArchivedRecipes,
			nextRecipeOffset: routeNextRecipeOffset
		});
	});

	onMount(() => {
		void hydrateCachedMenu(data.activeHouseholdId);

		unsubscribeActiveHousehold = activeHouseholdId.subscribe((householdId) => {
			if (!householdId) {
				void clearUserRouteDataCache(data.session?.user.id);
				writeActiveHouseholdCookie(null);
				recipes = [];
				archivedRecipes = [];
				nextRecipeOffset = null;
				return;
			}
			if (householdId !== data.activeHouseholdId) void hydrateCachedMenu(householdId, true);
		});
	});
	onDestroy(() => unsubscribeActiveHousehold?.());
</script>

<MyMenuDashboard {recipes} {archivedRecipes} {nextRecipeOffset} />

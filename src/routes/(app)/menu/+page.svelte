<script lang="ts">
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

	const cacheScope = (householdId: string | null | undefined = data.activeHouseholdId) => ({
		userId: data.session?.user.id,
		householdId
	});

	const hydrateCachedMenu = async (
		householdId: string | null | undefined,
		clearWhenMissing = false
	) => {
		const version = ++cacheHydrationVersion;
		const cached = await getCachedMenuRouteData(cacheScope(householdId));
		if (version !== cacheHydrationVersion || (!cached && !clearWhenMissing)) return;
		recipes = cached?.recipes ?? [];
		archivedRecipes = cached?.archivedRecipes ?? [];
		nextRecipeOffset = cached?.nextRecipeOffset ?? null;
	};

	$effect(() => {
		const routeRecipes = data.recipes ?? [];
		const routeArchivedRecipes = data.archivedRecipes ?? [];
		const routeNextRecipeOffset = data.nextRecipeOffset ?? null;

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

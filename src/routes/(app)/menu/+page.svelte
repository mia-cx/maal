<script lang="ts">
	import { MyMenuDashboard, type RecipeMenuItem } from '$lib/components/menu';
	import { activeHouseholdId } from '$lib/stores/active-household';
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
		});
	});

	onMount(() => {
		unsubscribeActiveHousehold = activeHouseholdId.subscribe((householdId) => {
			if (householdId && householdId !== data.activeHouseholdId) {
				recipes = [];
				archivedRecipes = [];
				nextRecipeOffset = null;
			}
		});
	});
	onDestroy(() => unsubscribeActiveHousehold?.());
</script>

<MyMenuDashboard {recipes} {archivedRecipes} {nextRecipeOffset} />

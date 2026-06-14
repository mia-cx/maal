<script lang="ts">
	import { MyMenuDashboard, type RecipeMenuItem } from '$lib/components/menu';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let recipes = $state<RecipeMenuItem[]>([]);
	let archivedRecipes = $state<RecipeMenuItem[]>([]);
	let nextRecipeOffset = $state<number | null>(null);

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
</script>

<MyMenuDashboard {recipes} {archivedRecipes} {nextRecipeOffset} />

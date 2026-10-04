<script lang="ts">
	import { liveQuery } from 'dexie';
	import { Schema } from 'effect';
	import { onMount } from 'svelte';

	import {
		createRecipeFromEditor,
		deleteRecipe,
		listRecoverableRecipes,
		listRecipes,
		permanentlyDeleteRecipe,
		restoreRecipe,
		updateRecipeFromEditor,
		type RecipeCommandContext
	} from '$lib/client/recipes/index.js';
	import { liveRecipeStatistics } from '$lib/client/recipes/statistics.js';
	import { confirmUrlImport, fetchRecipeUrlCandidate } from '$lib/client/recipes/url-import.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { DomainIdSchema } from '$lib/domain/contracts/primitives.js';
	import type { RecipeAggregate } from '$lib/domain/recipes/schema.js';
	import { MyMenuDashboard, type RecipeMenuItem } from '$lib/components/menu/index.js';
	import type { RecipeMenuStats } from '$lib/menu/recipe-defaults.js';
	import {
		importedCandidateToMenuItem,
		recipeAggregateToMenuItem,
		recipeMenuItemToEditorPatch
	} from '$lib/menu/recipe-local-adapter.js';

	let database = $state<MaalDatabase | null>(null);
	let library = $state.raw<{ recipes: RecipeAggregate[]; archivedRecipes: RecipeAggregate[] }>({
		recipes: [],
		archivedRecipes: []
	});
	let statistics = $state.raw<ReadonlyMap<string, RecipeMenuStats>>(new Map());
	let activeOwnerUserId = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	// Only a successful statistics emission may clear its error, not library updates.
	let statisticsError = $state<string | null>(null);
	const visibleError = $derived(loadError ?? statisticsError);

	const toMenuItem = (recipe: RecipeAggregate) =>
		recipeAggregateToMenuItem(recipe, statistics.get(recipe.id));
	const recipes = $derived(library.recipes.map(toMenuItem));
	const archivedRecipes = $derived(library.archivedRecipes.map(toMenuItem));

	const commandContext = async (): Promise<RecipeCommandContext> => {
		if (!database || !activeOwnerUserId) throw new Error('Choose a local profile first.');
		const activeProfileId = (await database.uiState.get('activeProfileId'))?.value;
		if (typeof activeProfileId !== 'string') throw new Error('Choose a local profile first.');
		const slot = await database.authSlots.where('profileId').equals(activeProfileId).first();
		const device = await database.meta.get('deviceId');
		return {
			authSlotId: slot?.authSlotId ?? `signed-out:${activeProfileId}`,
			ownerUserId: activeOwnerUserId,
			originDeviceId: Schema.decodeUnknownSync(DomainIdSchema)(device?.value)
		};
	};

	const saveRecipe = async (recipe: RecipeMenuItem) => {
		if (!database) throw new Error('Local recipe storage is still opening.');
		const context = await commandContext();
		if (recipe.importedCandidate) {
			await confirmUrlImport(database, context, recipe.importedCandidate, recipe);
			return;
		}
		const patch = recipeMenuItemToEditorPatch(recipe);
		if (recipe.id.startsWith('draft-recipe-')) {
			await createRecipeFromEditor(database, context, patch);
			return;
		}
		await updateRecipeFromEditor(database, context, recipe.id, patch);
	};

	const importRecipeFromUrl = async (url: string): Promise<RecipeMenuItem> => {
		if (!database) throw new Error('Local recipe storage is still opening.');
		const candidate = await fetchRecipeUrlCandidate(database, url);
		return importedCandidateToMenuItem(candidate, `draft-recipe-${crypto.randomUUID()}`);
	};

	const deleteLocalRecipe = async (recipe: RecipeMenuItem) => {
		if (!database) throw new Error('Local recipe storage is still opening.');
		await deleteRecipe(database, await commandContext(), recipe.id);
	};

	const restoreLocalRecipe = async (recipe: RecipeMenuItem) => {
		if (!database) throw new Error('Local recipe storage is still opening.');
		await restoreRecipe(database, await commandContext(), recipe.id);
	};

	const permanentlyDeleteLocalRecipes = async (selected: RecipeMenuItem[]) => {
		if (!database) throw new Error('Local recipe storage is still opening.');
		const context = await commandContext();
		for (const recipe of selected) await permanentlyDeleteRecipe(database, context, recipe.id);
	};

	onMount(() => {
		let cancelled = false;
		let subscription: { unsubscribe: () => void } | undefined;
		let statisticsSubscription: { unsubscribe: () => void } | undefined;

		void getBrowserDatabase()
			.then((opened) => {
				if (cancelled) {
					opened.close();
					return;
				}
				database = opened;
				subscription = liveQuery(async () => {
					const activeProfileId = (await opened.uiState.get('activeProfileId'))?.value;
					if (typeof activeProfileId !== 'string') {
						return { ownerUserId: null, recipes: [], archivedRecipes: [] };
					}
					const profile = await opened.profiles.get(activeProfileId);
					if (!profile) return { ownerUserId: null, recipes: [], archivedRecipes: [] };
					const [active, deleted] = await Promise.all([
						listRecipes(opened, profile.workosUserId),
						listRecoverableRecipes(opened, profile.workosUserId)
					]);
					return { ownerUserId: profile.workosUserId, recipes: active, archivedRecipes: deleted };
				}).subscribe({
					next: (next) => {
						activeOwnerUserId = next.ownerUserId;
						library = next;
						loadError = null;
					},
					error: () => {
						loadError = 'Your local recipe library could not be read.';
					}
				});
				// Separate from the library query so meal changes don't re-read every recipe.
				statisticsSubscription = liveRecipeStatistics(opened).subscribe({
					next: (next) => {
						statistics = next;
						statisticsError = null;
					},
					error: () => {
						statisticsError = 'Your local recipe library could not be read.';
					}
				});
			})
			.catch(() => {
				loadError = 'Your local recipe library could not be opened.';
			});

		return () => {
			cancelled = true;
			subscription?.unsubscribe();
			statisticsSubscription?.unsubscribe();
		};
	});
</script>

{#if visibleError}
	<div role="alert" class="grid gap-1 p-4 text-sm text-destructive">
		<p>{visibleError}</p>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="underline underline-offset-4" href="/recovery">Open local recovery</a>
	</div>
{/if}

<MyMenuDashboard
	{recipes}
	{archivedRecipes}
	onsave={saveRecipe}
	onimporturl={importRecipeFromUrl}
	ondelete={deleteLocalRecipe}
	onrestore={restoreLocalRecipe}
	onpermanentdelete={permanentlyDeleteLocalRecipes}
/>

<script lang="ts">
	import { liveQuery } from 'dexie';
	import { Schema } from 'effect';
	import { onMount } from 'svelte';

	import {
		commitImportedRecipeCandidate,
		createRecipeFromEditor,
		deleteRecipe,
		listRecoverableRecipes,
		listRecipes,
		permanentlyDeleteRecipe,
		restoreRecipe,
		updateRecipeFromEditor,
		type RecipeCommandContext
	} from '$lib/client/recipes/index.js';
	import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
	import { DomainIdSchema } from '$lib/domain/contracts/primitives.js';
	import { MyMenuDashboard, type RecipeMenuItem } from '$lib/components/menu/index.js';
	import {
		mergeEditorIntoImportedCandidate,
		recipeAggregateToMenuItem,
		recipeMenuItemToEditorPatch
	} from '$lib/menu/recipe-local-adapter.js';

	let database = $state<MaalDatabase | null>(null);
	let recipes = $state<RecipeMenuItem[]>([]);
	let archivedRecipes = $state<RecipeMenuItem[]>([]);
	let activeOwnerUserId = $state<string | null>(null);
	let loadError = $state<string | null>(null);

	const databaseEnvironment = (): string => {
		const configured = import.meta.env.VITE_MAAL_DATABASE_ENVIRONMENT?.trim();
		return configured || import.meta.env.MODE;
	};

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
			await commitImportedRecipeCandidate(
				database,
				context,
				mergeEditorIntoImportedCandidate(recipe.importedCandidate, recipe)
			);
			return;
		}
		const patch = recipeMenuItemToEditorPatch(recipe);
		if (recipe.id.startsWith('draft-recipe-')) {
			await createRecipeFromEditor(database, context, patch);
			return;
		}
		await updateRecipeFromEditor(database, context, recipe.id, patch);
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

		void openMaalDatabase(databaseEnvironment())
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
					next: (library) => {
						activeOwnerUserId = library.ownerUserId;
						recipes = library.recipes.map(recipeAggregateToMenuItem);
						archivedRecipes = library.archivedRecipes.map(recipeAggregateToMenuItem);
						loadError = null;
					},
					error: () => {
						loadError = 'Your local recipe library could not be read.';
					}
				});
			})
			.catch(() => {
				loadError = 'Your local recipe library could not be opened.';
			});

		return () => {
			cancelled = true;
			subscription?.unsubscribe();
			database?.close();
		};
	});
</script>

{#if loadError}
	<p role="alert" class="p-4 text-sm text-destructive">{loadError}</p>
{/if}

<MyMenuDashboard
	{recipes}
	{archivedRecipes}
	onsave={saveRecipe}
	ondelete={deleteLocalRecipe}
	onrestore={restoreLocalRecipe}
	onpermanentdelete={permanentlyDeleteLocalRecipes}
/>

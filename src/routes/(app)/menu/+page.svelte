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
	import { detachDeletedRecipeFromMeals } from '$lib/client/meals/index.js';
	import { getBrowserDatabase } from '$lib/client/local/browser.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
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
		const context = await commandContext();
		await deleteRecipe(database, context, recipe.id);
		const memberships = await database.memberships
			.where('workosUserId')
			.equals(context.ownerUserId)
			.filter(({ status }) => status !== 'revoked')
			.toArray();
		for (const membership of memberships) {
			await detachDeletedRecipeFromMeals(
				database,
				{
					...context,
					householdId: membership.householdId,
					reporterUserId: context.ownerUserId
				},
				recipe.id
			);
		}
	};

	const restoreLocalRecipe = async (recipe: RecipeMenuItem) => {
		if (!database) throw new Error('Local recipe storage is still opening.');
		await restoreRecipe(database, await commandContext(), recipe.id);
	};

	const permanentlyDeleteLocalRecipes = async (selected: RecipeMenuItem[]) => {
		if (!database) throw new Error('Local recipe storage is still opening.');
		const context = await commandContext();
		const memberships = await database.memberships
			.where('workosUserId')
			.equals(context.ownerUserId)
			.filter(({ status }) => status !== 'revoked')
			.toArray();
		for (const recipe of selected) {
			for (const membership of memberships) {
				await detachDeletedRecipeFromMeals(
					database,
					{
						...context,
						householdId: membership.householdId,
						reporterUserId: context.ownerUserId
					},
					recipe.id
				);
			}
			await permanentlyDeleteRecipe(database, context, recipe.id);
		}
	};

	onMount(() => {
		let cancelled = false;
		let subscription: { unsubscribe: () => void } | undefined;

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
		};
	});
</script>

{#if loadError}
	<div role="alert" class="grid gap-1 p-4 text-sm text-destructive">
		<p>{loadError}</p>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="underline underline-offset-4" href="/recovery">Open local recovery</a>
	</div>
{/if}

<MyMenuDashboard
	{recipes}
	{archivedRecipes}
	onsave={saveRecipe}
	ondelete={deleteLocalRecipe}
	onrestore={restoreLocalRecipe}
	onpermanentdelete={permanentlyDeleteLocalRecipes}
/>

<script lang="ts">
	import * as Accordion from '$lib/components/ui/accordion';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { MENU_RECIPE_PAGE_SIZE } from '$lib/menu/pagination';
	import {
		appendMenuRecipes,
		archivedMenuRecipesStore,
		createMenuRecipe,
		deleteMenuRecipe,
		hydrateMenuRecipes,
		menuRecipesStore,
		permanentlyDeleteMenuRecipe,
		restoreMenuRecipe,
		selectMenuRecipe,
		selectedMenuRecipeStore,
		updateMenuRecipe
	} from '$lib/stores/menu-recipes';
	import MyMenuRecipeSheet from './recipe-edit-sheet.svelte';
	import RecipeMenuCard from './recipe-menu-card.svelte';
	import type { RecipeMenuItem } from './menu-types';

	let {
		recipes: initialRecipes = [],
		archivedRecipes: initialArchivedRecipes = [],
		nextRecipeOffset: initialNextRecipeOffset = null
	}: {
		recipes?: RecipeMenuItem[];
		archivedRecipes?: RecipeMenuItem[];
		nextRecipeOffset?: number | null;
	} = $props();

	let sheetOpen = $state(false);
	let draftRecipe = $state<RecipeMenuItem | null>(null);
	let archiveActionError = $state<string | null>(null);
	let archiveActionRecipeId = $state<string | null>(null);
	let selectedRecipeIds = $state<string[]>([]);
	let selectedArchivedRecipeIds = $state<string[]>([]);
	let permanentDeleteRecipes = $state<RecipeMenuItem[]>([]);
	let permanentDeleteOpen = $state(false);
	let permanentDeleteButton = $state<HTMLButtonElement | null>(null);
	let hydratedRecipesSignature = $state('');
	let nextRecipeOffset = $state<number | null>(null);
	let recipesLoading = $state(false);
	let recipesLoadError = $state<string | null>(null);
	let loadMoreElement = $state<HTMLElement>();

	const recipes = $derived($menuRecipesStore);
	const archivedRecipes = $derived($archivedMenuRecipesStore);
	const selectedRecipe = $derived(draftRecipe ?? $selectedMenuRecipeStore);
	const selectedRecipes = $derived(
		recipes.filter((recipe) => selectedRecipeIds.includes(recipe.id))
	);
	const selectedArchivedRecipes = $derived(
		archivedRecipes.filter((recipe) => selectedArchivedRecipeIds.includes(recipe.id))
	);

	$effect(() => {
		const signature = [
			initialRecipes.map((recipe) => recipe.id).join('|'),
			initialArchivedRecipes.map((recipe) => recipe.id).join('|')
		].join('::');
		if (signature === hydratedRecipesSignature) return;
		hydratedRecipesSignature = signature;
		nextRecipeOffset = initialNextRecipeOffset;
		hydrateMenuRecipes(initialRecipes, initialArchivedRecipes);
	});

	const loadMoreRecipes = async () => {
		if (nextRecipeOffset === null || recipesLoading) return;
		recipesLoading = true;
		recipesLoadError = null;
		const response = await fetch(
			resolve(`/menu/recipes?offset=${nextRecipeOffset}&limit=${MENU_RECIPE_PAGE_SIZE}` as Pathname)
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

	const idsMatch = (left: string[], right: string[]): boolean =>
		left.length === right.length && left.every((id) => right.includes(id));

	$effect(() => {
		const nextSelectedRecipeIds = selectedRecipeIds.filter((id) =>
			recipes.some((recipe) => recipe.id === id)
		);
		if (!idsMatch(selectedRecipeIds, nextSelectedRecipeIds))
			selectedRecipeIds = nextSelectedRecipeIds;
	});

	$effect(() => {
		const nextSelectedArchivedRecipeIds = selectedArchivedRecipeIds.filter((id) =>
			archivedRecipes.some((recipe) => recipe.id === id)
		);
		if (!idsMatch(selectedArchivedRecipeIds, nextSelectedArchivedRecipeIds)) {
			selectedArchivedRecipeIds = nextSelectedArchivedRecipeIds;
		}
	});

	$effect(() => {
		if (!permanentDeleteOpen || !permanentDeleteButton) return;
		setTimeout(() => permanentDeleteButton?.focus());
	});

	$effect(() => {
		if (permanentDeleteOpen) return;
		permanentDeleteRecipes = [];
	});

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
		draftRecipe = null;
		selectMenuRecipe(recipe.id);
		sheetOpen = true;
	};

	const archivedDate = (archivedAt?: string): string => archivedAt?.slice(0, 10) ?? '';

	const readAddRecipeError = (error: unknown): string => {
		if (error instanceof Error) return error.message;
		return 'Could not add that recipe.';
	};

	const readResponseError = async (response: Response, fallback: string): Promise<string> => {
		try {
			const body = (await response.json()) as { message?: unknown };
			if (typeof body.message === 'string' && body.message.trim()) return body.message;
		} catch {
			// Fall through to fallback.
		}
		return fallback;
	};

	const draftRecipeFromTitle = (title = 'New recipe'): RecipeMenuItem => ({
		id: `draft-recipe-${crypto.randomUUID()}`,
		title,
		description: '',
		ingredientCount: 0,
		appliances: [],
		timesCooked: 0,
		plannedCount: 0,
		reviewSummary: {
			worthRepeating: 0,
			neutral: 0,
			neverAgain: 0,
			notes: []
		},
		ingredients: [{ amount: '', item: '' }],
		instructions: [{ position: 1, text: '' }]
	});

	const openAddRecipe = () => {
		selectMenuRecipe(null);
		draftRecipe = draftRecipeFromTitle();
		sheetOpen = true;
	};

	const loadRecipeDraftFromUrl = async (url: string): Promise<RecipeMenuItem> => {
		const response = await fetch(
			resolve(`/menu/recipes?importUrl=${encodeURIComponent(url)}` as Pathname)
		);
		if (!response.ok)
			throw new Error(await readResponseError(response, 'Could not import recipe.'));
		const body = (await response.json()) as { recipe: RecipeMenuItem };
		draftRecipe = body.recipe;
		return body.recipe;
	};

	const saveRecipeFromSheet = async (recipe: RecipeMenuItem) => {
		if (!recipe.id.startsWith('draft-recipe-')) {
			updateMenuRecipe(recipe);
			return;
		}
		const savedRecipe = await createMenuRecipe({ recipe });
		draftRecipe = null;
		openRecipe(savedRecipe);
	};

	const toggleRecipeSelection = (recipe: RecipeMenuItem, selected: boolean) => {
		selectedRecipeIds = selected
			? selectedRecipeIds.includes(recipe.id)
				? selectedRecipeIds
				: [...selectedRecipeIds, recipe.id]
			: selectedRecipeIds.filter((id) => id !== recipe.id);
	};

	const toggleArchivedRecipeSelection = (recipe: RecipeMenuItem, selected: boolean) => {
		selectedArchivedRecipeIds = selected
			? selectedArchivedRecipeIds.includes(recipe.id)
				? selectedArchivedRecipeIds
				: [...selectedArchivedRecipeIds, recipe.id]
			: selectedArchivedRecipeIds.filter((id) => id !== recipe.id);
	};

	const archiveSelectedRecipes = async () => {
		if (!selectedRecipes.length) return;
		archiveActionRecipeId = 'bulk-archive';
		archiveActionError = null;
		try {
			for (const recipe of selectedRecipes) await deleteMenuRecipe(recipe);
			selectedRecipeIds = [];
		} catch (error) {
			archiveActionError = readAddRecipeError(error);
		} finally {
			archiveActionRecipeId = null;
		}
	};

	const restoreSelectedArchivedRecipes = async () => {
		if (!selectedArchivedRecipes.length) return;
		archiveActionRecipeId = 'bulk-restore';
		archiveActionError = null;
		try {
			for (const recipe of selectedArchivedRecipes) await restoreMenuRecipe(recipe);
			selectedArchivedRecipeIds = [];
		} catch (error) {
			archiveActionError = readAddRecipeError(error);
		} finally {
			archiveActionRecipeId = null;
		}
	};

	const restoreArchivedRecipe = async (recipe: RecipeMenuItem) => {
		archiveActionRecipeId = recipe.id;
		archiveActionError = null;
		try {
			await restoreMenuRecipe(recipe);
		} catch (error) {
			archiveActionError = readAddRecipeError(error);
		} finally {
			archiveActionRecipeId = null;
		}
	};

	const confirmPermanentDelete = (recipes: RecipeMenuItem | RecipeMenuItem[]) => {
		permanentDeleteRecipes = Array.isArray(recipes) ? recipes : [recipes];
		archiveActionError = null;
		permanentDeleteOpen = true;
	};

	const permanentlyDeleteArchivedRecipe = async () => {
		if (!permanentDeleteRecipes.length) return;
		archiveActionRecipeId = 'permanent-delete';
		archiveActionError = null;
		try {
			for (const recipe of permanentDeleteRecipes) await permanentlyDeleteMenuRecipe(recipe);
			selectedArchivedRecipeIds = [];
			permanentDeleteOpen = false;
			permanentDeleteRecipes = [];
		} catch (error) {
			archiveActionError = readAddRecipeError(error);
		} finally {
			archiveActionRecipeId = null;
		}
	};
</script>

<svelte:head>
	<title>My Menu · Maal</title>
</svelte:head>

<section class="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
	<header
		class="sticky top-0 z-40 flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2"
	>
		<div class="flex shrink-0 items-center gap-2 text-foreground">
			<div class="flex w-9 shrink-0 items-center justify-center">
				<Sidebar.Trigger />
			</div>
		</div>
		<Button variant="outline" size="sm" onclick={openAddRecipe}>Add recipe</Button>
	</header>

	<div class="@container/my-menu-main min-h-0 flex-1 overflow-auto p-3 md:p-4">
		{#if selectedRecipes.length}
			<div
				class="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
			>
				<p class="text-sm font-medium">
					{selectedRecipes.length} recipe{selectedRecipes.length === 1 ? '' : 's'} selected
				</p>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={() => (selectedRecipeIds = [])}>
						Deselect all
					</Button>
					<Button
						variant="destructive"
						size="sm"
						disabled={Boolean(archiveActionRecipeId)}
						onclick={archiveSelectedRecipes}
					>
						Archive selected
					</Button>
				</div>
			</div>
		{/if}

		<div
			class="grid grid-cols-1 gap-3 md:gap-4 @min-[42rem]/my-menu-main:grid-cols-2 @min-[64rem]/my-menu-main:grid-cols-3 @min-[86rem]/my-menu-main:grid-cols-4"
		>
			{#each recipes as recipe (recipe.id)}
				<RecipeMenuCard
					{recipe}
					selected={selectedRecipeIds.includes(recipe.id)}
					onselect={openRecipe}
					onselectionchange={toggleRecipeSelection}
				/>
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

		<Accordion.Root type="multiple" class="border-border bg-background">
			<Accordion.Item value="archive">
				<Accordion.Trigger level={2} class="px-3 py-2">
					<span>Archive ({archivedRecipes.length})</span>
				</Accordion.Trigger>
				<Accordion.Content class="px-3 pb-3">
					{#if archiveActionError}
						<p class="mb-2 text-xs text-destructive">{archiveActionError}</p>
					{/if}
					{#if selectedArchivedRecipes.length}
						<div
							class="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<p class="text-sm font-medium">
								{selectedArchivedRecipes.length} archived recipe{selectedArchivedRecipes.length ===
								1
									? ''
									: 's'} selected
							</p>
							<div class="flex flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => (selectedArchivedRecipeIds = [])}
								>
									Deselect all
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={Boolean(archiveActionRecipeId)}
									onclick={restoreSelectedArchivedRecipes}
								>
									Restore selected
								</Button>
								<Button
									variant="destructive"
									size="sm"
									disabled={Boolean(archiveActionRecipeId)}
									onclick={() => confirmPermanentDelete(selectedArchivedRecipes)}
								>
									Delete selected forever
								</Button>
							</div>
						</div>
					{/if}
					{#if archivedRecipes.length}
						<div class="grid gap-2">
							{#each archivedRecipes as recipe (recipe.id)}
								<div
									class="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div class="flex min-w-0 gap-3">
										<Checkbox
											checked={selectedArchivedRecipeIds.includes(recipe.id)}
											aria-label={`Select ${recipe.title}`}
											onclick={() =>
												toggleArchivedRecipeSelection(
													recipe,
													!selectedArchivedRecipeIds.includes(recipe.id)
												)}
										/>
										<div class="min-w-0">
											<p class="truncate text-sm font-medium">{recipe.title}</p>
											<p class="text-xs text-muted-foreground">
												Archived{recipe.archivedAt ? ` ${archivedDate(recipe.archivedAt)}` : ''}
												{#if recipe.plannedCount}
													· {recipe.plannedCount} linked meal{recipe.plannedCount === 1 ? '' : 's'}
												{/if}
											</p>
										</div>
									</div>
									<div class="flex shrink-0 gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={archiveActionRecipeId === recipe.id}
											onclick={() => restoreArchivedRecipe(recipe)}
										>
											Restore
										</Button>
										<Button
											variant="destructive"
											size="sm"
											disabled={archiveActionRecipeId === recipe.id}
											onclick={() => confirmPermanentDelete(recipe)}
										>
											Delete forever
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">Archived recipes will show up here.</p>
					{/if}
				</Accordion.Content>
			</Accordion.Item>
		</Accordion.Root>
	</div>
</section>

<Dialog.Root bind:open={permanentDeleteOpen}>
	<Dialog.Content showCloseButton={false} class="sm:max-w-[24rem]">
		<Dialog.Header>
			<Dialog.Title>
				Permanently delete recipe{permanentDeleteRecipes.length === 1 ? '' : 's'}?
			</Dialog.Title>
			<Dialog.Description>
				This cannot be undone. All meals linked to {permanentDeleteRecipes.length === 1
					? `“${permanentDeleteRecipes[0]?.title ?? 'this recipe'}”`
					: `${permanentDeleteRecipes.length} recipes`} will also be deleted.
			</Dialog.Description>
		</Dialog.Header>
		{#if archiveActionError}
			<p class="text-xs text-destructive">{archiveActionError}</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button
				variant="ghost"
				disabled={Boolean(archiveActionRecipeId)}
				onclick={() => (permanentDeleteOpen = false)}
			>
				Cancel
			</Button>
			<Button
				bind:ref={permanentDeleteButton}
				variant="destructive"
				disabled={Boolean(archiveActionRecipeId)}
				onclick={permanentlyDeleteArchivedRecipe}
			>
				Delete recipe{permanentDeleteRecipes.length === 1 ? '' : 's'} and meals
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<MyMenuRecipeSheet
	bind:open={sheetOpen}
	recipe={selectedRecipe}
	onsaved={saveRecipeFromSheet}
	ondeleted={deleteMenuRecipe}
	onimporturl={loadRecipeDraftFromUrl}
/>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import * as Accordion from '$lib/components/ui/accordion';
	import * as Card from '$lib/components/ui/card';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import DeleteConfirmDialog from '$lib/components/delete-confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import MyMenuRecipeSheet from './recipe-edit-sheet.svelte';
	import RecipeMenuCard from './recipe-menu-card.svelte';
	import { rankRecipeWindow } from '$lib/menu/recipe-ranking';
	import { createDraftRecipe } from '$lib/menu/recipe-draft';
	import { toggleMenuSelection } from '$lib/menu/menu-selection';
	import type { RecipeMenuItem } from '$lib/menu/menu-types';

	let {
		recipes = [],
		archivedRecipes = [],
		onsave,
		ondelete,
		onrestore,
		onpermanentdelete,
		onimporturl = async () => {
			throw new Error('URL import requires an active Maal plan.');
		}
	}: {
		recipes?: RecipeMenuItem[];
		archivedRecipes?: RecipeMenuItem[];
		onsave?: (recipe: RecipeMenuItem) => void | Promise<void>;
		ondelete?: (recipe: RecipeMenuItem) => void | Promise<void>;
		onrestore?: (recipe: RecipeMenuItem) => void | Promise<void>;
		onpermanentdelete?: (recipes: RecipeMenuItem[]) => void | Promise<void>;
		onimporturl?: (url: string) => Promise<RecipeMenuItem>;
	} = $props();

	let sheetOpen = $state(false);
	let draftRecipe = $state<RecipeMenuItem | null>(null);
	let archiveActionError = $state<string | null>(null);
	let archiveActionRecipeId = $state<string | null>(null);
	let selectedRecipeIds = $state<string[]>([]);
	let selectedArchivedRecipeIds = $state<string[]>([]);
	let lastSelectedRecipeId = $state<string | null>(null);
	let lastSelectedArchivedRecipeId = $state<string | null>(null);
	let archivedRangeSelection = false;
	let permanentDeleteRecipes = $state<RecipeMenuItem[]>([]);
	let permanentDeleteOpen = $state(false);
	let recipeSearchQuery = $state('');
	let selectedRecipeId = $state<string | null>(null);
	let displayedRecipeLimit = $state(120);
	let previousRecipeSearchQuery = '';

	const selectedRecipe = $derived(
		draftRecipe ?? recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null
	);
	const rankedRecipeWindow = $derived(
		rankRecipeWindow(recipes, recipeSearchQuery, displayedRecipeLimit)
	);
	const displayedRecipes = $derived(rankedRecipeWindow.recipes);
	const hiddenRecipeCount = $derived(
		Math.max(0, rankedRecipeWindow.total - displayedRecipes.length)
	);
	const selectedRecipes = $derived(
		displayedRecipes.filter((recipe) => selectedRecipeIds.includes(recipe.id))
	);
	const recipeWord = (count: number): string =>
		count === 1 ? m.menu_recipe_word_singular() : m.menu_recipe_word_plural();
	const archivedRecipeWord = (count: number): string =>
		count === 1 ? m.menu_archived_recipe_word_singular() : m.menu_archived_recipe_word_plural();
	const linkedMealWord = (count: number): string =>
		count === 1 ? m.menu_linked_meal_word_singular() : m.menu_linked_meal_word_plural();
	const permanentDeleteTarget = $derived(
		permanentDeleteRecipes.length === 1
			? (permanentDeleteRecipes[0]?.title ?? m.menu_this_recipe())
			: m.menu_archived_recipes_selected({
					count: permanentDeleteRecipes.length,
					recipeWord: archivedRecipeWord(permanentDeleteRecipes.length)
				})
	);
	const selectedArchivedRecipes = $derived(
		archivedRecipes.filter((recipe) => selectedArchivedRecipeIds.includes(recipe.id))
	);

	const idsMatch = (left: string[], right: string[]): boolean =>
		left.length === right.length && left.every((id) => right.includes(id));

	$effect(() => {
		if (recipeSearchQuery === previousRecipeSearchQuery) return;
		previousRecipeSearchQuery = recipeSearchQuery;
		displayedRecipeLimit = 120;
	});

	$effect(() => {
		const selectableRecipes = displayedRecipes;
		const nextSelectedRecipeIds = selectedRecipeIds.filter((id) =>
			selectableRecipes.some((recipe) => recipe.id === id)
		);
		if (!idsMatch(selectedRecipeIds, nextSelectedRecipeIds)) {
			selectedRecipeIds = nextSelectedRecipeIds;
		}
		if (
			lastSelectedRecipeId &&
			!selectableRecipes.some((recipe) => recipe.id === lastSelectedRecipeId)
		) {
			lastSelectedRecipeId = null;
		}
	});

	$effect(() => {
		const nextSelectedArchivedRecipeIds = selectedArchivedRecipeIds.filter((id) =>
			archivedRecipes.some((recipe) => recipe.id === id)
		);
		if (!idsMatch(selectedArchivedRecipeIds, nextSelectedArchivedRecipeIds)) {
			selectedArchivedRecipeIds = nextSelectedArchivedRecipeIds;
		}
		if (
			lastSelectedArchivedRecipeId &&
			!archivedRecipes.some((recipe) => recipe.id === lastSelectedArchivedRecipeId)
		) {
			lastSelectedArchivedRecipeId = null;
		}
	});

	$effect(() => {
		if (permanentDeleteOpen) return;
		permanentDeleteRecipes = [];
	});

	const openRecipe = (recipe: RecipeMenuItem) => {
		draftRecipe = null;
		selectedRecipeId = recipe.id;
		sheetOpen = true;
	};

	const archivedDate = (archivedAt?: string): string => archivedAt?.slice(0, 10) ?? '';

	const readAddRecipeError = (error: unknown): string => {
		if (error instanceof Error) return error.message;
		return m.menu_could_not_add_that_recipe();
	};

	const openAddRecipe = () => {
		selectedRecipeId = null;
		draftRecipe = createDraftRecipe(() => crypto.randomUUID());
		sheetOpen = true;
	};

	const loadRecipeDraftFromUrl = (url: string): Promise<RecipeMenuItem> => onimporturl(url);

	const saveRecipeFromSheet = async (recipe: RecipeMenuItem) => {
		await onsave?.(recipe);
		draftRecipe = null;
		selectedRecipeId = recipe.id.startsWith('draft-recipe-') ? null : recipe.id;
	};

	const toggleRecipeSelection = (recipe: RecipeMenuItem, selected: boolean, range = false) => {
		selectedRecipeIds = toggleMenuSelection({
			items: displayedRecipes,
			selectedIds: selectedRecipeIds,
			lastSelectedId: lastSelectedRecipeId,
			itemId: recipe.id,
			selected,
			range
		});
		lastSelectedRecipeId = recipe.id;
	};

	const toggleArchivedRecipeSelection = (
		recipe: RecipeMenuItem,
		selected: boolean,
		range = false
	) => {
		selectedArchivedRecipeIds = toggleMenuSelection({
			items: archivedRecipes,
			selectedIds: selectedArchivedRecipeIds,
			lastSelectedId: lastSelectedArchivedRecipeId,
			itemId: recipe.id,
			selected,
			range
		});
		lastSelectedArchivedRecipeId = recipe.id;
	};

	const archiveSelectedRecipes = async () => {
		if (!selectedRecipes.length) return;
		archiveActionRecipeId = 'bulk-archive';
		archiveActionError = null;
		try {
			await Promise.all(selectedRecipes.map((recipe) => ondelete?.(recipe)));
			selectedRecipeIds = [];
			lastSelectedRecipeId = null;
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
			await Promise.all(selectedArchivedRecipes.map((recipe) => onrestore?.(recipe)));
			selectedArchivedRecipeIds = [];
			lastSelectedArchivedRecipeId = null;
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
			await onrestore?.(recipe);
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
			await onpermanentdelete?.(permanentDeleteRecipes);
			selectedArchivedRecipeIds = [];
			lastSelectedArchivedRecipeId = null;
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
	<title>{m.menu_my_menu_maal()}</title>
</svelte:head>

<section class="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
	<header
		class="sticky top-0 z-40 flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-background px-2"
	>
		<div class="flex shrink-0 items-center gap-2 text-foreground">
			<div class="flex w-9 shrink-0 items-center justify-center">
				<Sidebar.Trigger />
			</div>
		</div>
	</header>

	<div class="@container/my-menu-main min-h-0 flex-1 overflow-auto p-3 md:p-4">
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<p class="mr-2 text-sm font-medium">
				{selectedRecipes.length} recipe{selectedRecipes.length === 1 ? '' : 's'} selected
			</p>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!selectedRecipes.length}
					onclick={() => {
						selectedRecipeIds = [];
						lastSelectedRecipeId = null;
					}}
				>
					{m.menu_deselect_all()}
				</Button>
				<Button
					variant="destructive"
					size="sm"
					disabled={!selectedRecipes.length || Boolean(archiveActionRecipeId)}
					onclick={archiveSelectedRecipes}
				>
					{m.menu_archive_selected()}
				</Button>
			</div>
			<label class="relative ml-auto min-w-56 flex-1 sm:max-w-80">
				<span class="sr-only">{m.menu_search_recipes()}</span>
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={recipeSearchQuery}
					placeholder={m.menu_search_recipes_2()}
					class="h-8 pl-8"
				/>
			</label>
		</div>

		<div
			class="grid grid-cols-1 gap-3 md:gap-4 @min-[42rem]/my-menu-main:grid-cols-2 @min-[64rem]/my-menu-main:grid-cols-3 @min-[86rem]/my-menu-main:grid-cols-4"
		>
			<Card.Root
				size="sm"
				class="h-full min-w-0 gap-0 overflow-hidden border-dashed bg-card/30 py-0 text-left shadow-sm ring-1 ring-border/70 transition-colors hover:bg-card/60 hover:ring-foreground/25 data-[size=sm]:py-0"
			>
				<button
					type="button"
					class="flex h-full min-h-40 w-full flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
					onclick={openAddRecipe}
				>
					<span
						class="flex size-10 items-center justify-center rounded-full border border-border bg-background"
					>
						<PlusIcon class="size-5" />
					</span>
					<span class="text-sm font-semibold text-foreground">{m.menu_add_recipe()}</span>
					<span class="max-w-40 text-xs leading-5"
						>{m.menu_create_a_recipe_or_import_from_a_url()}</span
					>
				</button>
			</Card.Root>
			{#each displayedRecipes as recipe (recipe.id)}
				<RecipeMenuCard
					{recipe}
					selected={selectedRecipeIds.includes(recipe.id)}
					onselect={openRecipe}
					onselectionchange={toggleRecipeSelection}
				/>
			{/each}
		</div>
		{#if hiddenRecipeCount > 0}
			<div class="flex justify-center py-4">
				<Button
					variant="outline"
					onclick={() => (displayedRecipeLimit += 120)}
					aria-label={`Show more recipes, ${hiddenRecipeCount} remaining`}
				>
					Show more recipes ({hiddenRecipeCount} remaining)
				</Button>
			</div>
		{/if}
		{#if recipeSearchQuery.trim() && displayedRecipes.length === 0}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{m.menu_no_recipes_match_query({ query: recipeSearchQuery })}
			</p>
		{/if}
		<div class="min-h-10 py-4"></div>

		<Accordion.Root type="multiple" class="border-border bg-background">
			<Accordion.Item value="archive">
				<Accordion.Trigger level={2} class="px-3 py-2">
					<span>{m.menu_archive_with_count({ count: archivedRecipes.length })}</span>
				</Accordion.Trigger>
				<Accordion.Content class="px-3 pb-3">
					{#if archiveActionError}
						<p class="mb-2 text-xs text-destructive">{archiveActionError}</p>
					{/if}
					<div
						class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3"
					>
						<p class="mr-2 text-sm font-medium">
							{m.menu_archived_recipes_selected({
								count: selectedArchivedRecipes.length,
								recipeWord: archivedRecipeWord(selectedArchivedRecipes.length)
							})}
						</p>
						<div class="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={!selectedArchivedRecipes.length}
								onclick={() => {
									selectedArchivedRecipeIds = [];
									lastSelectedArchivedRecipeId = null;
								}}
							>
								{m.menu_deselect_all()}
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={!selectedArchivedRecipes.length || Boolean(archiveActionRecipeId)}
								onclick={restoreSelectedArchivedRecipes}
							>
								{m.menu_restore_selected()}
							</Button>
							<Button
								variant="destructive"
								size="sm"
								disabled={!selectedArchivedRecipes.length || Boolean(archiveActionRecipeId)}
								onclick={() => confirmPermanentDelete(selectedArchivedRecipes)}
							>
								{m.menu_delete_selected_forever()}
							</Button>
						</div>
					</div>
					{#if archivedRecipes.length}
						<div class="grid gap-2">
							{#each archivedRecipes as recipe (recipe.id)}
								<div
									class="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div class="flex min-w-0 gap-3">
										<Checkbox
											checked={selectedArchivedRecipeIds.includes(recipe.id)}
											aria-label={m.menu_select_recipe({ title: recipe.title })}
											onpointerdown={(event) => (archivedRangeSelection = event.shiftKey)}
											onkeydown={(event) => {
												if (event.key === ' ' || event.key === 'Enter') {
													archivedRangeSelection = event.shiftKey;
												}
											}}
											onCheckedChange={(checked) => {
												toggleArchivedRecipeSelection(recipe, checked, archivedRangeSelection);
												archivedRangeSelection = false;
											}}
										/>
										<div class="min-w-0">
											<p class="truncate text-sm font-medium">{recipe.title}</p>
											<p class="text-xs text-muted-foreground">
												{recipe.archivedAt
													? m.menu_archived_recipe_status({ date: archivedDate(recipe.archivedAt) })
													: m.menu_archived_recipe_status_no_date()}
												{#if recipe.plannedCount}
													· {m.menu_linked_meals_count({
														count: recipe.plannedCount,
														mealWord: linkedMealWord(recipe.plannedCount)
													})}
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
											{m.menu_restore()}
										</Button>
										<Button
											variant="destructive"
											size="sm"
											disabled={archiveActionRecipeId === recipe.id}
											onclick={() => confirmPermanentDelete(recipe)}
										>
											{m.menu_delete_forever()}
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">
							{m.menu_archived_recipes_will_show_up_here()}
						</p>
					{/if}
				</Accordion.Content>
			</Accordion.Item>
		</Accordion.Root>
	</div>
</section>

<DeleteConfirmDialog
	bind:open={permanentDeleteOpen}
	contentClass="sm:max-w-[24rem]"
	title={m.menu_permanently_delete_recipes_title({
		count: permanentDeleteRecipes.length,
		recipeWord: recipeWord(permanentDeleteRecipes.length)
	})}
	description={m.menu_permanently_delete_recipes_description({ target: permanentDeleteTarget })}
	confirmLabel={m.menu_delete_recipes_and_meals({
		count: permanentDeleteRecipes.length,
		recipeWord: recipeWord(permanentDeleteRecipes.length)
	})}
	busy={Boolean(archiveActionRecipeId)}
	error={archiveActionError}
	onconfirm={permanentlyDeleteArchivedRecipe}
/>

<MyMenuRecipeSheet
	bind:open={sheetOpen}
	recipe={selectedRecipe}
	onsaved={saveRecipeFromSheet}
	ondeleted={ondelete}
	onimporturl={loadRecipeDraftFromUrl}
/>

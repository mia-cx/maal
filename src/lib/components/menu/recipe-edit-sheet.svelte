<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Input } from '$lib/components/ui/input';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { RecipeIngredientItem, RecipeInstructionItem, RecipeMenuItem } from './menu-types';

	type DraftIngredient = RecipeIngredientItem & { draftId: string };
	type DraftInstruction = RecipeInstructionItem & { draftId: string };

	let {
		open = $bindable(false),
		recipe,
		onsaved,
		ondeleted
	}: {
		open?: boolean;
		recipe: RecipeMenuItem | null;
		onsaved?: (recipe: RecipeMenuItem) => void;
		ondeleted?: (recipe: RecipeMenuItem) => void | Promise<void>;
	} = $props();

	let editingRecipeId = $state<string | null>(null);
	let title = $state('');
	let sourceUrl = $state('');
	let sourceSiteName = $state('');
	let sourceAuthorName = $state('');
	let sourcePublisherName = $state('');
	let sourceIsBasedOnUrl = $state('');
	let description = $state('');
	let image = $state('');
	let prepTimeMinutes = $state('');
	let cookTimeMinutes = $state('');
	let recipeYield = $state('');
	let ingredients = $state<DraftIngredient[]>([]);
	let instructions = $state<DraftInstruction[]>([]);
	let deleteConfirmOpen = $state(false);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);
	let sheetHeroElement = $state<HTMLElement>();
	let sheetViewportHeight = $state(0);
	let sheetHeroHeight = $state(0);

	const sheetViewportGutter = 16;
	const sheetTopOffset = $derived(
		Math.max(sheetViewportGutter, (sheetViewportHeight - sheetHeroHeight) / 2)
	);
	const sheetLeadIn = $derived(Math.max(0, sheetTopOffset - sheetViewportGutter));
	const textareaClass =
		'min-h-20 w-full rounded-md border border-input bg-input/20 px-2 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-xs/relaxed';

	const numberText = (value?: number): string => (value === undefined ? '' : String(value));
	const optionalNumber = (value: string): number | undefined => {
		const trimmed = value.trim();
		if (!trimmed) return;
		const number = Number(trimmed);
		return Number.isFinite(number) ? number : undefined;
	};
	const optionalWholeNumber = (value: string): number | undefined => {
		const number = optionalNumber(value);
		return number === undefined ? undefined : Math.max(1, Math.round(number));
	};

	const defaultIngredients = (nextRecipe: RecipeMenuItem): DraftIngredient[] => {
		const recipeIngredients = nextRecipe.ingredients ?? [];
		if (!recipeIngredients.length)
			return [{ draftId: crypto.randomUUID(), amount: '', unit: '', item: '' }];
		return recipeIngredients.map((ingredient) => ({
			...ingredient,
			unit: ingredient.unit ?? '',
			draftId: crypto.randomUUID()
		}));
	};

	const defaultInstructions = (nextRecipe: RecipeMenuItem): DraftInstruction[] => {
		const recipeInstructions = nextRecipe.instructions ?? [];
		if (!recipeInstructions.length)
			return [{ draftId: crypto.randomUUID(), position: 1, text: '' }];
		return recipeInstructions
			.toSorted((left, right) => left.position - right.position)
			.map((instruction) => ({ ...instruction, draftId: crypto.randomUUID() }));
	};

	const syncRecipe = (nextRecipe: RecipeMenuItem | null) => {
		editingRecipeId = nextRecipe?.id ?? null;
		title = nextRecipe?.title ?? '';
		sourceUrl = nextRecipe?.sourceUrl ?? '';
		sourceSiteName = nextRecipe?.sourceSiteName ?? '';
		sourceAuthorName = nextRecipe?.sourceAuthorName ?? '';
		sourcePublisherName = nextRecipe?.sourcePublisherName ?? '';
		sourceIsBasedOnUrl = nextRecipe?.sourceIsBasedOnUrl ?? '';
		description = nextRecipe?.description ?? '';
		image = nextRecipe?.image ?? '';
		prepTimeMinutes = numberText(nextRecipe?.prepTimeMinutes);
		cookTimeMinutes = numberText(nextRecipe?.cookTimeMinutes);
		recipeYield = numberText(nextRecipe?.yield);
		ingredients = nextRecipe ? defaultIngredients(nextRecipe) : [];
		instructions = nextRecipe ? defaultInstructions(nextRecipe) : [];
	};

	const sortedInstructions = $derived(
		instructions.toSorted((left, right) => left.position - right.position)
	);

	$effect(() => {
		if (recipe?.id !== editingRecipeId) syncRecipe(recipe);
	});

	$effect(() => {
		if (open) return;
		deleteConfirmOpen = false;
		deleteBusy = false;
		deleteError = null;
	});

	$effect(() => {
		const element = sheetHeroElement;
		if (!open || !element) return;

		const updateSheetMetrics = () => {
			sheetViewportHeight = window.visualViewport?.height ?? window.innerHeight;
			sheetHeroHeight = element.offsetHeight;
		};
		const observer = new ResizeObserver(updateSheetMetrics);
		observer.observe(element);
		updateSheetMetrics();
		window.visualViewport?.addEventListener('resize', updateSheetMetrics);
		window.addEventListener('resize', updateSheetMetrics);

		return () => {
			observer.disconnect();
			window.visualViewport?.removeEventListener('resize', updateSheetMetrics);
			window.removeEventListener('resize', updateSheetMetrics);
		};
	});

	const updateIngredientAmount = (draftId: string, amount: string) => {
		ingredients = ingredients.map((ingredient) =>
			ingredient.draftId === draftId ? { ...ingredient, amount } : ingredient
		);
	};

	const updateIngredientUnit = (draftId: string, unit: string) => {
		ingredients = ingredients.map((ingredient) =>
			ingredient.draftId === draftId ? { ...ingredient, unit } : ingredient
		);
	};

	const updateIngredientItem = (draftId: string, item: string) => {
		ingredients = ingredients.map((ingredient) =>
			ingredient.draftId === draftId ? { ...ingredient, item } : ingredient
		);
	};

	const addIngredient = () => {
		ingredients = [
			...ingredients,
			{ draftId: crypto.randomUUID(), amount: '', unit: '', item: '' }
		];
	};

	const removeIngredient = (draftId: string) => {
		ingredients = ingredients.filter((ingredient) => ingredient.draftId !== draftId);
		if (!ingredients.length)
			ingredients = [{ draftId: crypto.randomUUID(), amount: '', unit: '', item: '' }];
	};

	const updateInstructionText = (draftId: string, text: string) => {
		instructions = instructions.map((instruction) =>
			instruction.draftId === draftId ? { ...instruction, text } : instruction
		);
	};

	const updateInstructionPosition = (draftId: string, value: string) => {
		const parsedPosition = Math.max(1, Math.round(Number(value.replace(/\D/g, '')) || 1));
		const nextInstructions = instructions.map((instruction) => ({ ...instruction }));
		const movingInstruction = nextInstructions.find(
			(instruction) => instruction.draftId === draftId
		);
		if (!movingInstruction) return;
		movingInstruction.position = parsedPosition;

		let conflictingPosition = parsedPosition;
		while (true) {
			const conflictingInstruction = nextInstructions.find(
				(instruction) =>
					instruction.draftId !== draftId && instruction.position === conflictingPosition
			);
			if (!conflictingInstruction) break;
			conflictingInstruction.position += 1;
			conflictingPosition = conflictingInstruction.position;
		}

		instructions = nextInstructions.toSorted((left, right) => left.position - right.position);
	};

	const swapInstructionPosition = (draftId: string, direction: -1 | 1) => {
		const orderedInstructions = sortedInstructions;
		const index = orderedInstructions.findIndex((instruction) => instruction.draftId === draftId);
		const neighbor = orderedInstructions[index + direction];
		const current = orderedInstructions[index];
		if (!current || !neighbor) return;
		instructions = instructions.map((instruction) => {
			if (instruction.draftId === current.draftId) {
				return { ...instruction, position: neighbor.position };
			}
			if (instruction.draftId === neighbor.draftId) {
				return { ...instruction, position: current.position };
			}
			return instruction;
		});
	};

	const addInstruction = () => {
		const nextPosition =
			Math.max(0, ...instructions.map((instruction) => instruction.position)) + 1;
		instructions = [
			...instructions,
			{ draftId: crypto.randomUUID(), position: nextPosition, text: '' }
		];
	};

	const removeInstruction = (draftId: string) => {
		instructions = instructions.filter((instruction) => instruction.draftId !== draftId);
		if (!instructions.length) {
			instructions = [{ draftId: crypto.randomUUID(), position: 1, text: '' }];
		}
	};

	const savedInstructions = (): RecipeInstructionItem[] =>
		instructions
			.map(({ position, text }) => ({ position, text: text.trim() }))
			.filter((instruction) => instruction.text)
			.toSorted((left, right) => left.position - right.position)
			.map((instruction, index) => ({ ...instruction, position: index + 1 }));

	const saveRecipe = (event?: SubmitEvent) => {
		event?.preventDefault();
		if (!recipe) return;

		const savedIngredients = ingredients
			.map(({ amount, unit, item }) => ({
				amount: amount.trim(),
				unit: unit?.trim() || undefined,
				item: item.trim()
			}))
			.filter((ingredient) => ingredient.amount || ingredient.unit || ingredient.item);
		onsaved?.({
			...recipe,
			title: title.trim() || recipe.title,
			sourceUrl: sourceUrl.trim() || undefined,
			sourceSiteName: sourceSiteName.trim() || undefined,
			sourceAuthorName: sourceAuthorName.trim() || undefined,
			sourcePublisherName: sourcePublisherName.trim() || undefined,
			sourceIsBasedOnUrl: sourceIsBasedOnUrl.trim() || undefined,
			description: description.trim(),
			image: image.trim() || undefined,
			prepTimeMinutes: optionalNumber(prepTimeMinutes),
			cookTimeMinutes: optionalNumber(cookTimeMinutes),
			totalTimeMinutes: undefined,
			yield: optionalWholeNumber(recipeYield),
			ingredients: savedIngredients,
			ingredientCount: savedIngredients.length,
			instructions: savedInstructions()
		});
		open = false;
	};

	const openDeleteConfirm = () => {
		deleteError = null;
		deleteConfirmOpen = true;
	};

	const deleteRecipe = async () => {
		if (!recipe || !ondeleted) return;
		deleteBusy = true;
		deleteError = null;
		try {
			await ondeleted(recipe);
			deleteConfirmOpen = false;
			open = false;
		} catch (error) {
			deleteError = error instanceof Error ? error.message : 'Could not delete recipe.';
		} finally {
			deleteBusy = false;
		}
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay />
		<DialogPrimitive.Content
			class="fixed inset-0 z-50 w-full overflow-hidden bg-transparent p-0 outline-none"
		>
			{#if recipe}
				<Sheet.Frame
					leadIn={sheetLeadIn}
					closeLabel="Close recipe editor"
					onclose={() => (open = false)}
				>
					<form class="contents" onsubmit={saveRecipe}>
						<div bind:this={sheetHeroElement} class="relative overflow-hidden rounded-t-xl">
							{#if image}
								<img src={image} alt="" class="aspect-[2/1] w-full object-cover" />
							{/if}

							<section class="px-5 py-5">
								<Dialog.Header class="pr-10">
									<Dialog.Title
										class="text-3xl leading-tight font-semibold tracking-tight sm:text-2xl"
									>
										Edit recipe
									</Dialog.Title>
								</Dialog.Header>
							</section>
						</div>

						<div class="space-y-5 px-5 pb-5">
							<div class="grid gap-4">
								<label class="grid gap-1 text-xs font-medium">
									Title
									<Input bind:value={title} />
								</label>

								<label class="grid gap-1 text-xs font-medium">
									Source URL
									<Input bind:value={sourceUrl} />
								</label>

								<div class="grid gap-3 sm:grid-cols-2">
									<label class="grid gap-1 text-xs font-medium">
										Source site
										<Input bind:value={sourceSiteName} />
									</label>
									<label class="grid gap-1 text-xs font-medium">
										Author
										<Input bind:value={sourceAuthorName} />
									</label>
									<label class="grid gap-1 text-xs font-medium">
										Publisher
										<Input bind:value={sourcePublisherName} />
									</label>
									<label class="grid gap-1 text-xs font-medium">
										Based on URL
										<Input bind:value={sourceIsBasedOnUrl} />
									</label>
								</div>

								<label class="grid gap-1 text-xs font-medium">
									Description
									<textarea bind:value={description} rows="4" class={textareaClass}></textarea>
								</label>

								<label class="grid gap-1 text-xs font-medium">
									Image URL
									<Input bind:value={image} />
								</label>

								<div class="grid gap-3 sm:grid-cols-3">
									<label class="grid gap-1 text-xs font-medium">
										Prep minutes
										<Input type="number" min="0" bind:value={prepTimeMinutes} />
									</label>
									<label class="grid gap-1 text-xs font-medium">
										Cook minutes
										<Input type="number" min="0" bind:value={cookTimeMinutes} />
									</label>
									<label class="grid gap-1 text-xs font-medium">
										Yield
										<Input type="number" min="1" step="1" bind:value={recipeYield} />
									</label>
								</div>
							</div>

							<section class="grid gap-2">
								<h3 class="text-xs font-medium text-foreground">Ingredients</h3>
								<div class="grid gap-2">
									{#each ingredients as ingredient, index (ingredient.draftId)}
										<div
											class="grid gap-2 sm:grid-cols-[4.5rem_5rem_minmax(0,1fr)_auto] sm:items-end"
										>
											<label class="grid gap-1 text-xs font-medium">
												Amt
												<Input
													value={ingredient.amount}
													oninput={(event) =>
														updateIngredientAmount(ingredient.draftId, event.currentTarget.value)}
													aria-label={`Ingredient ${index + 1} amount`}
													placeholder="2"
												/>
											</label>
											<label class="grid gap-1 text-xs font-medium">
												Unit
												<Input
													value={ingredient.unit ?? ''}
													oninput={(event) =>
														updateIngredientUnit(ingredient.draftId, event.currentTarget.value)}
													aria-label={`Ingredient ${index + 1} unit`}
													placeholder="tbsp"
												/>
											</label>
											<label class="grid gap-1 text-xs font-medium">
												Ingredient
												<Input
													value={ingredient.item}
													oninput={(event) =>
														updateIngredientItem(ingredient.draftId, event.currentTarget.value)}
													aria-label={`Ingredient ${index + 1}`}
													placeholder="olive oil"
												/>
											</label>
											<Button.Root
												variant="ghost"
												size="sm"
												onclick={() => removeIngredient(ingredient.draftId)}
											>
												Remove
											</Button.Root>
										</div>
									{/each}
								</div>
								<div>
									<Button.Root variant="outline" size="sm" onclick={addIngredient}
										>Add ingredient</Button.Root
									>
								</div>
							</section>

							<section class="grid gap-2">
								<h3 class="text-xs font-medium text-foreground">Instructions</h3>
								<div class="grid gap-3">
									{#each sortedInstructions as instruction, index (instruction.draftId)}
										<div class="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-start">
											<div class="grid gap-1 text-xs font-medium">
												<span>Position</span>
												<Button.Root
													type="button"
													variant="ghost"
													size="sm"
													class="h-7 px-2"
													disabled={index === 0}
													aria-label="Move instruction up"
													onclick={() => swapInstructionPosition(instruction.draftId, -1)}
												>
													<ChevronUpIcon class="size-4" />
												</Button.Root>
												<Input
													type="text"
													inputmode="numeric"
													value={String(instruction.position)}
													oninput={(event) =>
														updateInstructionPosition(
															instruction.draftId,
															event.currentTarget.value
														)}
													aria-label="Instruction position"
												/>
												<Button.Root
													type="button"
													variant="ghost"
													size="sm"
													class="h-7 px-2"
													disabled={index === sortedInstructions.length - 1}
													aria-label="Move instruction down"
													onclick={() => swapInstructionPosition(instruction.draftId, 1)}
												>
													<ChevronDownIcon class="size-4" />
												</Button.Root>
											</div>
											<label class="grid gap-1 text-xs font-medium">
												Text
												<textarea
													value={instruction.text}
													oninput={(event) =>
														updateInstructionText(instruction.draftId, event.currentTarget.value)}
													class={textareaClass}
												></textarea>
											</label>
											<div class="flex flex-wrap gap-1 sm:mt-5 sm:flex-col">
												<Button.Root
													type="button"
													variant="ghost"
													size="sm"
													onclick={() => removeInstruction(instruction.draftId)}
												>
													Remove
												</Button.Root>
											</div>
										</div>
									{/each}
								</div>
								<div>
									<Button.Root variant="outline" size="sm" onclick={addInstruction}
										>Add step</Button.Root
									>
								</div>
							</section>
						</div>
					</form>

					{#snippet footer()}
						<div
							class="flex items-center justify-between gap-2 rounded-b-xl border-t border-border bg-popover/95 p-3 backdrop-blur"
						>
							<div>
								{#if ondeleted}
									<Button.Root variant="destructive" onclick={openDeleteConfirm}>Delete</Button.Root
									>
								{/if}
							</div>
							<Button.Root type="button" onclick={() => saveRecipe()}>Save recipe</Button.Root>
						</div>
					{/snippet}
				</Sheet.Frame>
			{/if}
		</DialogPrimitive.Content>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content showCloseButton={false} class="sm:max-w-[22rem]">
		<Dialog.Header>
			<Dialog.Title>Are you sure you want to delete?</Dialog.Title>
			<Dialog.Description>
				This removes the recipe from My Menu. Planned meals keep their saved recipe snapshot.
			</Dialog.Description>
		</Dialog.Header>
		{#if deleteError}
			<p class="text-xs text-destructive">{deleteError}</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button.Root
				variant="ghost"
				disabled={deleteBusy}
				onclick={() => (deleteConfirmOpen = false)}
			>
				Keep recipe
			</Button.Root>
			<Button.Root variant="destructive" disabled={deleteBusy} onclick={deleteRecipe}>
				{deleteBusy ? 'Deleting…' : 'Delete recipe'}
			</Button.Root>
		</div>
	</Dialog.Content>
</Dialog.Root>

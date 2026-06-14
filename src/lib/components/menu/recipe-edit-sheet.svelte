<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import DeleteConfirmDialog from '$lib/components/delete-confirm-dialog.svelte';
	import { keyboardShortcut } from '$lib/actions/keyboard-shortcut';
	import { Input } from '$lib/components/ui/input';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import {
		defaultIngredients,
		defaultInstructions,
		instructionPositionDrafts as createInstructionPositionDrafts,
		numberText,
		optionalNumber,
		optionalWholeNumber,
		type DraftIngredient,
		type DraftInstruction
	} from '$lib/menu/recipe-editor-model';
	import RecipeIdentityFields from '$lib/components/menu/recipe-identity-fields.svelte';
	import RecipeIngredientsEditor from '$lib/components/menu/recipe-ingredients-editor.svelte';
	import RecipeInstructionsEditor from '$lib/components/menu/recipe-instructions-editor.svelte';
	import type { RecipeInstructionItem, RecipeMenuItem } from './menu-types';

	let {
		open = $bindable(false),
		recipe,
		onsaved,
		ondeleted,
		onimporturl
	}: {
		open?: boolean;
		recipe: RecipeMenuItem | null;
		onsaved?: (recipe: RecipeMenuItem) => void;
		ondeleted?: (recipe: RecipeMenuItem) => void | Promise<void>;
		onimporturl?: (url: string) => Promise<RecipeMenuItem>;
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
	let instructionPositionDrafts = $state<Record<string, string>>({});
	let instructionListElement = $state<HTMLElement>();
	let draggedInstruction = $state<DraftInstruction | null>(null);
	let draggedInstructionPointerId = $state<number | null>(null);
	let instructionDragX = $state(0);
	let instructionDragY = $state(0);
	let instructionDragOffsetX = $state(0);
	let instructionDragOffsetY = $state(0);
	let instructionDragWidth = $state(0);
	let instructionDropIndex = $state(0);
	let deleteConfirmOpen = $state(false);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);
	let importBusy = $state(false);
	let importError = $state<string | null>(null);
	let wasOpen = $state(false);
	let sheetHeroElement = $state<HTMLElement>();
	let sheetViewportHeight = $state(0);
	let sheetHeroHeight = $state(0);

	const sheetViewportGutter = 16;
	const sheetTopOffset = $derived(
		Math.max(sheetViewportGutter, (sheetViewportHeight - sheetHeroHeight) / 2)
	);
	const sheetLeadIn = $derived(Math.max(0, sheetTopOffset - sheetViewportGutter));
	const isDraftRecipe = $derived(Boolean(recipe?.id.startsWith('draft-recipe-')));
	const textareaClass =
		'min-h-20 w-full rounded-md border border-input bg-input/20 px-2 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-xs/relaxed';
	const sourceUrlCanImport = $derived(
		Boolean(onimporturl && /^https?:\/\//i.test(sourceUrl.trim()))
	);

	const syncInstructionPositionDrafts = (nextInstructions: DraftInstruction[]) => {
		instructionPositionDrafts = createInstructionPositionDrafts(nextInstructions);
	};

	const syncRecipe = (nextRecipe: RecipeMenuItem | null) => {
		const nextInstructions = nextRecipe ? defaultInstructions(nextRecipe) : [];
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
		instructions = nextInstructions;
		syncInstructionPositionDrafts(nextInstructions);
	};

	const sortedInstructions = $derived(
		instructions.toSorted((left, right) => left.position - right.position)
	);
	const visibleInstructions = $derived.by(() => {
		const dragged = draggedInstruction;
		return dragged
			? sortedInstructions.filter((instruction) => instruction.draftId !== dragged.draftId)
			: sortedInstructions;
	});

	$effect(() => {
		if (recipe?.id !== editingRecipeId) syncRecipe(recipe);
	});

	$effect(() => {
		if (open && !wasOpen) syncRecipe(recipe);
		if (!open && wasOpen) syncRecipe(recipe);
		wasOpen = open;
	});

	$effect(() => {
		if (open) return;
		deleteConfirmOpen = false;
		deleteBusy = false;
		deleteError = null;
		importBusy = false;
		importError = null;
		draggedInstruction = null;
		draggedInstructionPointerId = null;
		window.removeEventListener('pointermove', moveInstructionDrag);
		window.removeEventListener('pointerup', stopInstructionDrag);
		window.removeEventListener('pointercancel', stopInstructionDrag);
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

	const updateInstructionPositionDraft = (draftId: string, value: string) => {
		instructionPositionDrafts = {
			...instructionPositionDrafts,
			[draftId]: value.replace(/\D/g, '')
		};
	};

	const commitInstructionPosition = (draftId: string) => {
		const index = sortedInstructions.findIndex((instruction) => instruction.draftId === draftId);
		if (index < 0) return;
		const draft = instructionPositionDrafts[draftId] ?? '';
		const parsedPosition = Number(draft);
		if (!Number.isFinite(parsedPosition) || parsedPosition < 1) {
			syncInstructionPositionDrafts(instructions);
			return;
		}
		reorderInstructions(draftId, Math.round(parsedPosition) - 1);
	};

	const stepInstructionPositionDraft = (draftId: string, direction: -1 | 1) => {
		const instruction = instructions.find((item) => item.draftId === draftId);
		if (!instruction) return;
		const draftPosition = Number(instructionPositionDrafts[draftId] ?? instruction.position);
		const position = Number.isFinite(draftPosition) ? draftPosition : instruction.position;
		const nextPosition = Math.min(
			instructions.length,
			Math.max(1, Math.round(position) + direction)
		);
		instructionPositionDrafts = { ...instructionPositionDrafts, [draftId]: String(nextPosition) };
	};

	const handleInstructionPositionKeydown = (draftId: string, event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitInstructionPosition(draftId);
			(event.currentTarget as HTMLInputElement).blur();
		}
		if (event.key === 'Escape') {
			syncInstructionPositionDrafts(instructions);
			(event.currentTarget as HTMLInputElement).blur();
		}
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			stepInstructionPositionDraft(draftId, event.key === 'ArrowUp' ? 1 : -1);
		}
	};

	const reorderInstructions = (draftId: string, nextIndex: number) => {
		const current = sortedInstructions.find((instruction) => instruction.draftId === draftId);
		if (!current) return;
		const remaining = sortedInstructions.filter((instruction) => instruction.draftId !== draftId);
		remaining.splice(Math.max(0, Math.min(nextIndex, remaining.length)), 0, current);
		const nextInstructions = remaining.map((instruction, index) => ({
			...instruction,
			position: index + 1
		}));
		instructions = nextInstructions;
		syncInstructionPositionDrafts(nextInstructions);
	};

	const swapInstructionPosition = (draftId: string, direction: -1 | 1) => {
		const index = sortedInstructions.findIndex((instruction) => instruction.draftId === draftId);
		if (index < 0) return;
		reorderInstructions(draftId, index + direction);
	};

	const addInstruction = () => {
		const nextPosition =
			Math.max(0, ...instructions.map((instruction) => instruction.position)) + 1;
		const nextInstructions = [
			...instructions,
			{ draftId: crypto.randomUUID(), position: nextPosition, text: '' }
		];
		instructions = nextInstructions;
		syncInstructionPositionDrafts(nextInstructions);
	};

	const removeInstruction = (draftId: string) => {
		const nextInstructions = instructions.filter((instruction) => instruction.draftId !== draftId);
		instructions = nextInstructions.length
			? nextInstructions.map((instruction, index) => ({ ...instruction, position: index + 1 }))
			: [{ draftId: crypto.randomUUID(), position: 1, text: '' }];
		syncInstructionPositionDrafts(instructions);
	};

	const instructionRows = (): HTMLElement[] =>
		Array.from(
			instructionListElement?.querySelectorAll<HTMLElement>('[data-instruction-row]') ?? []
		);

	const instructionDropIndexFromPointer = (clientY: number): number => {
		let index = 0;
		for (const row of instructionRows()) {
			const rect = row.getBoundingClientRect();
			if (clientY < rect.top + rect.height / 2) return index;
			index += 1;
		}
		return index;
	};

	const stopInstructionDrag = (event: PointerEvent) => {
		if (draggedInstructionPointerId !== event.pointerId) return;
		if (draggedInstruction) reorderInstructions(draggedInstruction.draftId, instructionDropIndex);
		draggedInstruction = null;
		draggedInstructionPointerId = null;
		window.removeEventListener('pointermove', moveInstructionDrag);
		window.removeEventListener('pointerup', stopInstructionDrag);
		window.removeEventListener('pointercancel', stopInstructionDrag);
	};

	const moveInstructionDrag = (event: PointerEvent) => {
		if (draggedInstructionPointerId !== event.pointerId) return;
		instructionDragX = event.clientX;
		instructionDragY = event.clientY;
		instructionDropIndex = instructionDropIndexFromPointer(event.clientY);
	};

	const startInstructionDrag = (instruction: DraftInstruction, event: PointerEvent) => {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-instruction-row]');
		const rect = row?.getBoundingClientRect();
		event.preventDefault();
		draggedInstruction = instruction;
		draggedInstructionPointerId = event.pointerId;
		instructionDragX = event.clientX;
		instructionDragY = event.clientY;
		instructionDragOffsetX = rect ? event.clientX - rect.left : 0;
		instructionDragOffsetY = rect ? event.clientY - rect.top : 0;
		instructionDragWidth = rect?.width ?? 0;
		instructionDropIndex = sortedInstructions.findIndex(
			(item) => item.draftId === instruction.draftId
		);
		window.addEventListener('pointermove', moveInstructionDrag);
		window.addEventListener('pointerup', stopInstructionDrag);
		window.addEventListener('pointercancel', stopInstructionDrag);
	};

	const savedInstructions = (): RecipeInstructionItem[] =>
		instructions
			.map(({ position, text }) => ({ position, text: text.trim() }))
			.filter((instruction) => instruction.text)
			.toSorted((left, right) => left.position - right.position)
			.map((instruction, index) => ({ ...instruction, position: index + 1 }));

	const importSourceUrl = async () => {
		if (!recipe || !onimporturl || !sourceUrlCanImport || importBusy) return;
		importBusy = true;
		importError = null;
		try {
			const importedRecipe = await onimporturl(sourceUrl.trim());
			syncRecipe({ ...recipe, ...importedRecipe, id: recipe.id });
		} catch (error) {
			importError = error instanceof Error ? error.message : 'Could not import that recipe.';
		} finally {
			importBusy = false;
		}
	};

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

	const openArchiveConfirm = () => {
		if (!recipe || !ondeleted || deleteConfirmOpen) return;
		deleteError = null;
		deleteConfirmOpen = true;
	};

	const archiveRecipe = async () => {
		if (!recipe || !ondeleted) return;
		deleteBusy = true;
		deleteError = null;
		try {
			await ondeleted(recipe);
			deleteConfirmOpen = false;
			open = false;
		} catch (error) {
			deleteError = error instanceof Error ? error.message : 'Could not archive recipe.';
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
			<div
				use:keyboardShortcut={{
					target: 'window',
					bindings: [
						{
							id: 'delete-open-recipe',
							combo: { key: 'd' },
							handler: openArchiveConfirm,
							when: () => open && Boolean(recipe && ondeleted && !deleteConfirmOpen)
						}
					]
				}}
				class="contents"
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
											{isDraftRecipe ? 'Add recipe' : 'Edit recipe'}
										</Dialog.Title>
									</Dialog.Header>
								</section>
							</div>

							<div class="space-y-5 px-5 pb-5">
								<RecipeIdentityFields
									bind:title
									bind:sourceUrl
									bind:sourceSiteName
									bind:sourceAuthorName
									bind:sourcePublisherName
									bind:sourceIsBasedOnUrl
									bind:description
									bind:image
									bind:prepTimeMinutes
									bind:cookTimeMinutes
									bind:recipeYield
									{textareaClass}
									{onimporturl}
									{sourceUrlCanImport}
									{importBusy}
									{importError}
									{importSourceUrl}
								/>

								<RecipeIngredientsEditor
									{ingredients}
									{updateIngredientAmount}
									{updateIngredientUnit}
									{updateIngredientItem}
									{removeIngredient}
									{addIngredient}
								/>

								<RecipeInstructionsEditor
									bind:instructionListElement
									{visibleInstructions}
									sortedInstructionCount={sortedInstructions.length}
									{draggedInstruction}
									{instructionDropIndex}
									{instructionPositionDrafts}
									{textareaClass}
									{startInstructionDrag}
									{swapInstructionPosition}
									{updateInstructionPositionDraft}
									{commitInstructionPosition}
									{handleInstructionPositionKeydown}
									{updateInstructionText}
									{removeInstruction}
									{addInstruction}
								/>
							</div>
						</form>

						{#snippet footer()}
							<div
								class="flex items-center justify-between gap-2 rounded-b-xl border-t border-border bg-popover/95 p-3 backdrop-blur"
							>
								<div>
									{#if ondeleted}
										<Button.Root variant="destructive" onclick={openArchiveConfirm}
											>Archive</Button.Root
										>
									{/if}
								</div>
								<Button.Root type="button" onclick={() => saveRecipe()}>Save recipe</Button.Root>
							</div>
						{/snippet}
					</Sheet.Frame>
				{/if}
			</div>
		</DialogPrimitive.Content>
	</Dialog.Portal>
</Dialog.Root>

{#if draggedInstruction}
	<div
		class="pointer-events-none fixed z-[90] opacity-80 drop-shadow-xl"
		style={`left: ${instructionDragX - instructionDragOffsetX}px; top: ${instructionDragY - instructionDragOffsetY}px; width: ${instructionDragWidth}px; max-width: calc(100vw - 2rem);`}
	>
		<div
			class="grid gap-2 rounded-md border border-border bg-popover p-2 sm:grid-cols-[4.75rem_minmax(0,1fr)] sm:items-center"
		>
			<div class="flex items-stretch gap-1 text-xs font-medium">
				<span class="flex w-3 items-center justify-center text-muted-foreground">
					<GripVerticalIcon class="size-4" />
				</span>
				<div class="grid flex-1 gap-1">
					<Button.Root type="button" variant="outline" size="sm" class="h-7 px-1" disabled>
						<ChevronUpIcon class="size-4" />
					</Button.Root>
					<Input
						type="text"
						value={String(draggedInstruction.position)}
						readonly
						class="px-1 text-center"
					/>
					<Button.Root type="button" variant="outline" size="sm" class="h-7 px-1" disabled>
						<ChevronDownIcon class="size-4" />
					</Button.Root>
				</div>
			</div>
			<p
				class="min-h-[5.75rem] rounded-md border border-input bg-input/20 px-2 py-1.5 text-sm leading-relaxed"
			>
				{draggedInstruction.text}
			</p>
		</div>
	</div>
{/if}

<DeleteConfirmDialog
	bind:open={deleteConfirmOpen}
	title="Archive this recipe?"
	description="This removes the recipe from My Menu. Planned meals keep their saved recipe snapshot."
	confirmLabel="Archive recipe"
	confirmingLabel="Archiving…"
	cancelLabel="Keep recipe"
	busy={deleteBusy}
	error={deleteError}
	onconfirm={archiveRecipe}
/>

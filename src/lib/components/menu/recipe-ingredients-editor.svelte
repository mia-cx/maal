<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { DraftIngredient } from '$lib/menu/recipe-editor-model';

	let {
		ingredients,
		updateIngredientAmount,
		updateIngredientUnit,
		updateIngredientItem,
		removeIngredient,
		addIngredient
	}: {
		ingredients: DraftIngredient[];
		updateIngredientAmount: (draftId: string, value: string) => void;
		updateIngredientUnit: (draftId: string, value: string) => void;
		updateIngredientItem: (draftId: string, value: string) => void;
		removeIngredient: (draftId: string) => void;
		addIngredient: () => void;
	} = $props();
</script>

<section class="grid gap-2">
	<h3 class="text-xs font-medium text-foreground">Ingredients</h3>
	<div class="grid gap-2">
		{#each ingredients as ingredient, index (ingredient.draftId)}
			<div class="grid gap-2 sm:grid-cols-[4.5rem_5rem_minmax(0,1fr)_auto] sm:items-end">
				<div>
					<Input
						value={ingredient.amount}
						oninput={(event) =>
							updateIngredientAmount(ingredient.draftId, event.currentTarget.value)}
						aria-label={`Ingredient ${index + 1} amount`}
						placeholder="2"
					/>
				</div>
				<div>
					<Input
						value={ingredient.unit ?? ''}
						oninput={(event) => updateIngredientUnit(ingredient.draftId, event.currentTarget.value)}
						aria-label={`Ingredient ${index + 1} unit`}
						placeholder="tbsp"
					/>
				</div>
				<div>
					<Input
						value={ingredient.item}
						oninput={(event) => updateIngredientItem(ingredient.draftId, event.currentTarget.value)}
						aria-label={`Ingredient ${index + 1}`}
						placeholder="olive oil"
					/>
				</div>
				<Button.Root variant="ghost" size="sm" onclick={() => removeIngredient(ingredient.draftId)}>
					Remove
				</Button.Root>
			</div>
		{/each}
	</div>
	<div>
		<Button.Root variant="outline" size="sm" class="w-full" onclick={addIngredient}>
			Add ingredient
		</Button.Root>
	</div>
</section>

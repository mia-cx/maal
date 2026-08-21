import type {
	RecipeIngredientItem,
	RecipeInstructionItem,
	RecipeMenuItem
} from '$lib/menu/menu-types';

export type DraftIngredient = RecipeIngredientItem & { draftId: string };
export type DraftInstruction = RecipeInstructionItem & { draftId: string };

export const numberText = (value?: number): string => (value === undefined ? '' : String(value));

export const optionalNumber = (value: string | number | null | undefined): number | undefined => {
	if (value === null || value === undefined) return;
	const trimmed = String(value).trim();
	if (!trimmed) return;
	const number = Number(trimmed);
	return Number.isFinite(number) ? number : undefined;
};

export const optionalWholeNumber = (
	value: string | number | null | undefined
): number | undefined => {
	const number = optionalNumber(value);
	return number === undefined ? undefined : Math.max(1, Math.round(number));
};

const createDraftId = (): string => crypto.randomUUID();

export const defaultIngredients = (
	nextRecipe: RecipeMenuItem,
	createId: () => string = createDraftId
): DraftIngredient[] => {
	const recipeIngredients = nextRecipe.ingredients ?? [];
	if (!recipeIngredients.length) return [{ draftId: createId(), amount: '', unit: '', item: '' }];
	return recipeIngredients.map((ingredient) => ({
		...ingredient,
		unit: ingredient.unit ?? '',
		draftId: createId()
	}));
};

export const defaultInstructions = (
	nextRecipe: RecipeMenuItem,
	createId: () => string = createDraftId
): DraftInstruction[] => {
	const recipeInstructions = nextRecipe.instructions ?? [];
	if (!recipeInstructions.length) return [{ draftId: createId(), position: 1, text: '' }];
	return recipeInstructions
		.toSorted((left, right) => left.position - right.position)
		.map((instruction) => ({ ...instruction, draftId: createId() }));
};

export const instructionPositionDrafts = (
	nextInstructions: DraftInstruction[]
): Record<string, string> =>
	Object.fromEntries(
		nextInstructions.map((instruction) => [instruction.draftId, String(instruction.position)])
	);

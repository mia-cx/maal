import type { RecipeIngredientItem, RecipeInstructionItem, RecipeMenuItem } from './menu-types';

const optionalStringFields = [
	'description',
	'image',
	'sourceUrl',
	'sourceSiteName',
	'sourceAuthorName',
	'sourcePublisherName',
	'sourceIsBasedOnUrl',
	'archivedAt',
	'userNotes'
] as const;

const optionalNumberFields = [
	'prepTimeMinutes',
	'cookTimeMinutes',
	'totalTimeMinutes',
	'sourceClaimedMinutes',
	'yield',
	'parseConfidence',
	'ingredientConfidence',
	'instructionConfidence',
	'timesCooked',
	'plannedCount',
	'averageActualMinutes',
	'ingredientCount'
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string';

const isOptionalNumber = (value: unknown): value is number | undefined =>
	value === undefined || (typeof value === 'number' && Number.isFinite(value));

const isStringArray = (value: unknown): value is string[] | undefined =>
	value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));

const isIngredient = (value: unknown): value is RecipeIngredientItem =>
	isRecord(value) &&
	typeof value.amount === 'string' &&
	typeof value.item === 'string' &&
	isOptionalString(value.unit);

const isInstruction = (value: unknown): value is RecipeInstructionItem =>
	isRecord(value) &&
	typeof value.text === 'string' &&
	typeof value.position === 'number' &&
	Number.isInteger(value.position) &&
	value.position > 0;

export const parseRecipeMenuItemPayload = (value: unknown): RecipeMenuItem | undefined => {
	if (!isRecord(value)) return;
	if (typeof value.id !== 'string' || !value.id.trim()) return;
	if (typeof value.title !== 'string' || !value.title.trim()) return;
	for (const field of optionalStringFields) {
		if (!isOptionalString(value[field])) return;
	}
	for (const field of optionalNumberFields) {
		if (!isOptionalNumber(value[field])) return;
	}
	if (value.ingredients !== undefined) {
		if (!Array.isArray(value.ingredients) || !value.ingredients.every(isIngredient)) return;
	}
	if (value.instructions !== undefined) {
		if (!Array.isArray(value.instructions) || !value.instructions.every(isInstruction)) return;
	}
	if (!isStringArray(value.appliances) || !isStringArray(value.dietTags)) return;
	return value as RecipeMenuItem;
};

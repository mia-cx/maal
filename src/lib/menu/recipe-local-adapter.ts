import type { RecipeEditorPatch } from '$lib/client/recipes/commands.js';
import type { RecipeAggregate, RecipeImportedCandidate } from '$lib/domain/recipes/schema.js';
import { uuidv7 } from 'uuidv7';

import { emptyRecipeMenuStats } from './recipe-defaults.js';
import type { RecipeMenuItem } from './menu-types.js';

export const recipeAggregateToMenuItem = (recipe: RecipeAggregate): RecipeMenuItem => ({
	...emptyRecipeMenuStats(),
	id: recipe.id,
	title: recipe.title,
	description: recipe.description ?? '',
	image: recipe.imageUrl ?? undefined,
	sourceSiteName: recipe.sourceSiteName ?? undefined,
	sourceAuthorName: recipe.sourceAuthorName ?? undefined,
	sourcePublisherName: recipe.sourcePublisherName ?? undefined,
	sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl ?? undefined,
	sourceUrl: recipe.sourceUrl ?? undefined,
	sourceImportedAt: recipe.sourceImportedAt,
	sourceClaimedMinutes: recipe.sourceClaimedMinutes ?? undefined,
	archivedAt: recipe.deletedAt ?? undefined,
	parseConfidence: recipe.parseConfidence ?? undefined,
	ingredientConfidence: recipe.ingredientConfidence ?? undefined,
	instructionConfidence: recipe.instructionConfidence ?? undefined,
	nutritionConfidence: recipe.nutritionConfidence ?? undefined,
	userNotes: recipe.userNotes ?? undefined,
	prepTimeMinutes: recipe.prepTimeMinutes ?? undefined,
	cookTimeMinutes: recipe.cookTimeMinutes ?? undefined,
	totalTimeMinutes: recipe.totalTimeMinutes ?? undefined,
	yield: recipe.yield ?? undefined,
	ingredients: recipe.ingredients.map((ingredient) => ({
		id: ingredient.id,
		amount: ingredient.sourceAmountText ?? '',
		unit: ingredient.sourceUnitLabel ?? undefined,
		item: ingredient.sourceFoodLabel
	})),
	instructions: recipe.instructions.map((instruction) => ({
		id: instruction.id,
		position: instruction.stepIndex + 1,
		text: instruction.text
	})),
	ingredientCount: recipe.ingredients.length,
	appliances: recipe.applianceRequirements.map(({ appliance }) => appliance),
	dietTags: recipe.classifications.filter(({ kind }) => kind === 'diet').map(({ value }) => value)
});

export const recipeMenuItemToEditorPatch = (recipe: RecipeMenuItem): RecipeEditorPatch => ({
	title: recipe.title,
	description: recipe.description.trim() || null,
	imageUrl: recipe.image?.trim() || null,
	sourceUrl: recipe.sourceUrl?.trim() || null,
	sourceSiteName: recipe.sourceSiteName?.trim() || null,
	sourceAuthorName: recipe.sourceAuthorName?.trim() || null,
	sourcePublisherName: recipe.sourcePublisherName?.trim() || null,
	sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl?.trim() || null,
	prepTimeMinutes: recipe.prepTimeMinutes ?? null,
	cookTimeMinutes: recipe.cookTimeMinutes ?? null,
	yield: recipe.yield ?? null,
	ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
		id: ingredient.id ?? null,
		amount: ingredient.amount,
		unit: ingredient.unit ?? '',
		item: ingredient.item
	})),
	instructions: (recipe.instructions ?? []).map((instruction) => ({
		id: instruction.id ?? null,
		position: instruction.position,
		text: instruction.text
	}))
});

export const importedCandidateToMenuItem = (
	candidate: RecipeImportedCandidate,
	draftId: string
): RecipeMenuItem => ({
	...recipeAggregateToMenuItem({
		...candidate,
		id: draftId,
		ownerUserId: 'candidate',
		schemaVersion: 1,
		revision: 0,
		createdAt: candidate.sourceImportedAt,
		updatedAt: candidate.sourceImportedAt,
		deletedAt: null,
		conflictClocks: {},
		searchTokens: []
	}),
	id: draftId,
	importedCandidate: candidate
});

export const mergeEditorIntoImportedCandidate = (
	candidate: RecipeImportedCandidate,
	recipe: RecipeMenuItem
): RecipeImportedCandidate => {
	const patch = recipeMenuItemToEditorPatch(recipe);
	const ingredientById = new Map(
		candidate.ingredients.map((ingredient) => [ingredient.id, ingredient])
	);
	const instructionById = new Map(
		candidate.instructions.map((instruction) => [instruction.id, instruction])
	);
	const ingredients = patch.ingredients
		.filter(({ item }) => item.trim().length > 0)
		.map((edit, lineIndex) => {
			const existing = edit.id ? ingredientById.get(edit.id) : undefined;
			if (existing) {
				return {
					...existing,
					lineIndex,
					originalText: [edit.amount, edit.unit, edit.item].filter(Boolean).join(' '),
					sourceAmountText: edit.amount || null,
					sourceUnitLabel: edit.unit || null,
					sourceFoodLabel: edit.item
				};
			}
			const quantity = Number(edit.amount);
			return {
				id: uuidv7(),
				lineIndex,
				originalText: [edit.amount, edit.unit, edit.item].filter(Boolean).join(' '),
				sourceAmountText: edit.amount || null,
				sourceQuantity: Number.isFinite(quantity) ? quantity : null,
				sourceUnitLabel: edit.unit || null,
				sourceFoodLabel: edit.item,
				baseFoodId: null,
				baseQuantity: null,
				baseUnitId: null,
				baseUnitFamilyId: null,
				optional: false,
				confidence: 1,
				createdAt: candidate.sourceImportedAt
			};
		});
	const instructions = patch.instructions
		.filter(({ text }) => text.trim().length > 0)
		.toSorted((left, right) => left.position - right.position)
		.map((edit, stepIndex) => {
			const existing = edit.id ? instructionById.get(edit.id) : undefined;
			if (existing) return { ...existing, stepIndex, text: edit.text };
			return {
				id: uuidv7(),
				stepIndex,
				sectionName: null,
				text: edit.text,
				durationMinutes: null,
				confidence: 1,
				createdAt: candidate.sourceImportedAt,
				updatedAt: candidate.sourceImportedAt
			};
		});
	const retainedInstructionIds = new Set(instructions.map(({ id }) => id));
	return {
		...candidate,
		title: patch.title,
		description: patch.description,
		imageUrl: patch.imageUrl,
		sourceUrl: patch.sourceUrl,
		sourceSiteName: patch.sourceSiteName,
		sourceAuthorName: patch.sourceAuthorName,
		sourcePublisherName: patch.sourcePublisherName,
		sourceIsBasedOnUrl: patch.sourceIsBasedOnUrl,
		prepTimeMinutes: patch.prepTimeMinutes,
		cookTimeMinutes: patch.cookTimeMinutes,
		yield: patch.yield,
		ingredients,
		instructions,
		instructionEvents: candidate.instructionEvents.filter(({ recipeInstructionId }) =>
			retainedInstructionIds.has(recipeInstructionId)
		)
	};
};

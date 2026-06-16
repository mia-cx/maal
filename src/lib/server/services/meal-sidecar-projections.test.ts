import { describe, expect, it } from 'vitest';
import {
	recipeClassificationToMealClassification,
	recipeIngredientToMealIngredient,
	recipeInstructionToMealInstruction,
	recipeMediaToMealMedia,
	recipeNutritionFactToMealNutritionFact
} from './meal-sidecar-projections';

describe('recipe to meal sidecar projections', () => {
	it('copies ingredient fields without recipe ownership fields', () => {
		expect(
			recipeIngredientToMealIngredient('meal_1', {
				id: 'ingredient_1',
				userRecipeId: 'recipe_1',
				lineIndex: 2,
				originalText: '2 cups flour',
				sourceAmountText: '2 cups',
				sourceQuantity: 2,
				sourceUnitLabel: 'cups',
				sourceFoodLabel: 'flour',
				baseFoodId: 'flour',
				baseQuantity: 480,
				baseUnitId: 'grams',
				baseUnitFamilyId: 'mass',
				optional: false,
				confidence: 0.9,
				createdAt: '2026-06-14T00:00:00.000Z'
			})
		).toEqual({
			householdMealId: 'meal_1',
			lineIndex: 2,
			originalText: '2 cups flour',
			sourceAmountText: '2 cups',
			sourceQuantity: 2,
			sourceUnitLabel: 'cups',
			sourceFoodLabel: 'flour',
			baseFoodId: 'flour',
			baseQuantity: 480,
			baseUnitId: 'grams',
			baseUnitFamilyId: 'mass',
			optional: false,
			confidence: 0.9
		});
	});

	it('copies instruction fields without recipe ownership fields', () => {
		expect(
			recipeInstructionToMealInstruction('meal_1', {
				id: 'instruction_1',
				userRecipeId: 'recipe_1',
				stepIndex: 1,
				sectionName: 'Sauce',
				text: 'Simmer.',
				durationMinutes: 15,
				confidence: 1,
				createdAt: '2026-06-14T00:00:00.000Z',
				updatedAt: '2026-06-14T00:00:00.000Z'
			})
		).toEqual({
			householdMealId: 'meal_1',
			stepIndex: 1,
			sectionName: 'Sauce',
			text: 'Simmer.',
			durationMinutes: 15,
			confidence: 1
		});
	});

	it('copies classification, media, and nutrition sidecars', () => {
		expect(
			recipeClassificationToMealClassification('meal_1', {
				id: 'classification_1',
				userRecipeId: 'recipe_1',
				kind: 'cuisine',
				value: 'Italian',
				normalizedValue: 'italian',
				schemaOrgValue: 'Italian',
				locale: 'en-US',
				confidence: 1,
				createdAt: '2026-06-14T00:00:00.000Z'
			})
		).toEqual({
			householdMealId: 'meal_1',
			kind: 'cuisine',
			value: 'Italian',
			normalizedValue: 'italian',
			schemaOrgValue: 'Italian',
			locale: 'en-US',
			confidence: 1
		});
		expect(
			recipeMediaToMealMedia('meal_1', {
				id: 'media_1',
				userRecipeId: 'recipe_1',
				kind: 'image',
				position: 0,
				url: 'https://example.test/image.jpg',
				contentUrl: 'https://example.test/content.jpg',
				embedUrl: null,
				thumbnailUrl: null,
				name: 'Photo',
				caption: 'Finished dish',
				createdAt: '2026-06-14T00:00:00.000Z'
			})
		).toEqual({
			householdMealId: 'meal_1',
			kind: 'image',
			position: 0,
			url: 'https://example.test/image.jpg',
			contentUrl: 'https://example.test/content.jpg',
			embedUrl: null,
			thumbnailUrl: null,
			name: 'Photo',
			caption: 'Finished dish'
		});
		expect(
			recipeNutritionFactToMealNutritionFact('meal_1', {
				id: 'nutrition_1',
				userRecipeId: 'recipe_1',
				nutrient: 'calories',
				schemaOrgProperty: 'calories',
				originalText: '100 calories',
				amount: 100,
				unitId: 'kilocalories',
				baseAmount: 100,
				baseUnitId: 'kilocalories',
				locale: 'en-US',
				confidence: 1,
				createdAt: '2026-06-14T00:00:00.000Z',
				updatedAt: '2026-06-14T00:00:00.000Z'
			})
		).toEqual({
			householdMealId: 'meal_1',
			nutrient: 'calories',
			schemaOrgProperty: 'calories',
			originalText: '100 calories',
			amount: 100,
			unitId: 'kilocalories',
			baseAmount: 100,
			baseUnitId: 'kilocalories',
			locale: 'en-US',
			confidence: 1
		});
	});
});

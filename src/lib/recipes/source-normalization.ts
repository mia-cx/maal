/**
 * Turns recipe source text into structured rows against the global taxonomy seed. URL imports and
 * editor saves both run through here, on the Worker and in the browser, so it stays pure.
 */
import { uuidv7 } from 'uuidv7';

import type {
	InstructionEvent,
	RecipeIngredient,
	RecipeInstruction
} from '$lib/domain/recipes/schema.js';
import { toBaseQuantity } from '$lib/domain/taxonomy/conversion.js';
import { GLOBAL_UNIT_ALIAS_SEED, GLOBAL_UNIT_SEED } from '$lib/domain/taxonomy/global-seed.js';
import { normalizedAlias } from '$lib/taxonomy/aliases.js';

import {
	canonicalIngredientUnit,
	instructionUnitPatternFor,
	parseIngredientLine,
	parseQuantity,
	type IngredientUnitAliases,
	type ParsedIngredientLine
} from './ingredient-text.js';

type IngredientSourceFields = Pick<
	RecipeIngredient,
	| 'originalText'
	| 'sourceAmountText'
	| 'sourceQuantity'
	| 'sourceUnitLabel'
	| 'sourceFoodLabel'
	| 'baseFoodId'
	| 'baseQuantity'
	| 'baseUnitId'
	| 'baseUnitFamilyId'
>;

const TEMPERATURE_BASE_UNIT_ID = 'celsius';
const TEMPERATURE_EVENT_CONFIDENCE = 0.9;

// `parseIngredientLine` speaks compact labels ("cup"); the seed speaks unit IDs ("cups").
const seedUnitByCompact = new Map(
	GLOBAL_UNIT_SEED.flatMap((unit) => {
		const compact = canonicalIngredientUnit(unit.id);
		return compact ? [[compact, unit] as const] : [];
	})
);

// Matching is case-insensitive, so aliases that differ only by case ("t" teaspoon, "T" tablespoon)
// are ambiguous. They stay unparsed rather than risk a silent 3x quantity error.
const seedIngredientUnitAliases: IngredientUnitAliases = {};
const ambiguousAliases = new Set<string>();
for (const alias of GLOBAL_UNIT_ALIAS_SEED) {
	const compact = canonicalIngredientUnit(alias.unitId);
	if (!compact) continue;
	const key = normalizedAlias(alias.alias);
	if ((seedIngredientUnitAliases[key] ?? compact) !== compact) ambiguousAliases.add(key);
	seedIngredientUnitAliases[key] ??= compact;
}
for (const key of ambiguousAliases) delete seedIngredientUnitAliases[key];

const seedUnitFor = (label: string | null) => {
	if (!label) return undefined;
	const compact =
		canonicalIngredientUnit(label) ?? seedIngredientUnitAliases[normalizedAlias(label)];
	return compact ? seedUnitByCompact.get(compact) : undefined;
};

/**
 * Derives quantity and seed unit references for one ingredient. Source text is kept exactly as
 * given; `baseQuantity` is expressed in `baseUnitId`. No food seed exists, so `baseFoodId` is null.
 */
export const normalizeIngredientSource = (source: {
	originalText: string;
	amount: string;
	unit: string;
	item: string;
}): IngredientSourceFields => {
	const sourceAmountText = source.amount || null;
	const sourceUnitLabel = source.unit || null;
	const sourceQuantity = sourceAmountText === null ? null : parseQuantity(sourceAmountText);
	const unit = seedUnitFor(sourceUnitLabel);
	return {
		originalText: source.originalText,
		sourceAmountText,
		sourceQuantity,
		sourceUnitLabel,
		sourceFoodLabel: source.item,
		baseFoodId: null,
		baseQuantity: unit ? sourceQuantity : null,
		baseUnitId: unit?.id ?? null,
		baseUnitFamilyId: unit?.baseUnitId ?? null
	};
};

/** Splits an imported line such as "1 1/2 cups flour" into amount, unit, and food. */
export const parseIngredientSource = (line: string): IngredientSourceFields => {
	const parsed = parseIngredientLine(line, seedIngredientUnitAliases);
	// A bare number ("3") has no food to name, so the whole line stays the food label.
	const split: ParsedIngredientLine = parsed.item ? parsed : { amount: '', item: line };
	return normalizeIngredientSource({
		originalText: line,
		amount: split.amount,
		unit: split.unit ?? '',
		item: split.item
	});
};

const temperatureUnitById = new Map(
	GLOBAL_UNIT_SEED.filter(({ baseUnitId }) => baseUnitId === TEMPERATURE_BASE_UNIT_ID).map(
		(unit) => [unit.id, unit]
	)
);
const temperatureAliases = GLOBAL_UNIT_ALIAS_SEED.filter(
	({ baseUnitId, sourceDomain }) => baseUnitId === TEMPERATURE_BASE_UNIT_ID && sourceDomain === null
);
const temperatureUnitIdByAlias = new Map(
	temperatureAliases.map(({ alias, unitId }) => [normalizedAlias(alias), unitId])
);
const temperaturePattern = new RegExp(
	String.raw`(-?\d+(?:\.\d+)?)\s*(${[
		...new Set(temperatureAliases.flatMap(({ alias }) => [alias, normalizedAlias(alias)]))
	]
		.toSorted((left, right) => right.length - left.length)
		.map(instructionUnitPatternFor)
		.join('|')})\b`,
	'giu'
);

/** Temperature events ("350°F") found in one instruction, one per mention, in text order. */
export const parseInstructionEvents = (
	instruction: Pick<RecipeInstruction, 'id' | 'text'>,
	createdAt: InstructionEvent['createdAt']
): InstructionEvent[] =>
	[...instruction.text.matchAll(temperaturePattern)].flatMap(([sourceText, rawValue, rawUnit]) => {
		const unit = temperatureUnitById.get(
			temperatureUnitIdByAlias.get(normalizedAlias(rawUnit ?? '')) ?? ''
		);
		const value = Number(rawValue);
		if (!unit || !Number.isFinite(value)) return [];
		return [
			{
				id: uuidv7(),
				recipeInstructionId: instruction.id,
				kind: 'temperature' as const,
				appliance: null,
				sourceText,
				value,
				unitId: unit.id,
				baseValue: toBaseQuantity(value, unit),
				baseUnitId: unit.baseUnitId,
				confidence: TEMPERATURE_EVENT_CONFIDENCE,
				createdAt
			}
		];
	});

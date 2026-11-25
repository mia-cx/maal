import { Schema } from 'effect';

import {
	FoodAliasSchema,
	FoodSchema,
	UnitAliasSchema,
	UnitSchema,
	type Food,
	type FoodAlias,
	type Unit,
	type UnitAlias
} from './schema.js';

export const GLOBAL_TAXONOMY_SEED_VERSION = 1 as const;

const seededAt = '2026-08-21T00:00:00.000Z' as const;

export const GLOBAL_FOOD_SEED: readonly Food[] = [];
export const GLOBAL_FOOD_ALIAS_SEED: readonly FoodAlias[] = [];

export const GLOBAL_UNIT_SEED: readonly Unit[] = [
	{ id: 'grams', baseUnitId: 'grams', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'kilograms', baseUnitId: 'grams', toBaseFactor: 1000, toBaseOffset: 0 },
	{ id: 'milligrams', baseUnitId: 'grams', toBaseFactor: 0.001, toBaseOffset: 0 },
	{ id: 'ounces', baseUnitId: 'grams', toBaseFactor: 28.349523125, toBaseOffset: 0 },
	{ id: 'pounds', baseUnitId: 'grams', toBaseFactor: 453.59237, toBaseOffset: 0 },
	{ id: 'milliliters', baseUnitId: 'milliliters', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'liters', baseUnitId: 'milliliters', toBaseFactor: 1000, toBaseOffset: 0 },
	{ id: 'centiliters', baseUnitId: 'milliliters', toBaseFactor: 10, toBaseOffset: 0 },
	{ id: 'deciliters', baseUnitId: 'milliliters', toBaseFactor: 100, toBaseOffset: 0 },
	{ id: 'teaspoons', baseUnitId: 'milliliters', toBaseFactor: 4.92892159375, toBaseOffset: 0 },
	{ id: 'tablespoons', baseUnitId: 'milliliters', toBaseFactor: 14.78676478125, toBaseOffset: 0 },
	{ id: 'cups', baseUnitId: 'milliliters', toBaseFactor: 236.5882365, toBaseOffset: 0 },
	{ id: 'fluid_ounces', baseUnitId: 'milliliters', toBaseFactor: 29.5735295625, toBaseOffset: 0 },
	{ id: 'pints', baseUnitId: 'milliliters', toBaseFactor: 473.176473, toBaseOffset: 0 },
	{ id: 'quarts', baseUnitId: 'milliliters', toBaseFactor: 946.352946, toBaseOffset: 0 },
	{ id: 'gallons', baseUnitId: 'milliliters', toBaseFactor: 3785.411784, toBaseOffset: 0 },
	{ id: 'each', baseUnitId: 'each', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'pinches', baseUnitId: 'pinches', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'dashes', baseUnitId: 'dashes', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'drops', baseUnitId: 'drops', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'pieces', baseUnitId: 'pieces', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'cloves', baseUnitId: 'cloves', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'slices', baseUnitId: 'slices', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'cans', baseUnitId: 'cans', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'bunches', baseUnitId: 'bunches', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'handfuls', baseUnitId: 'handfuls', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'sprigs', baseUnitId: 'sprigs', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'stalks', baseUnitId: 'stalks', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'leaves', baseUnitId: 'leaves', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'heads', baseUnitId: 'heads', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'bulbs', baseUnitId: 'bulbs', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'jars', baseUnitId: 'jars', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'bottles', baseUnitId: 'bottles', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'packages', baseUnitId: 'packages', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'packets', baseUnitId: 'packets', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'seconds', baseUnitId: 'minutes', toBaseFactor: 0.0166666666666667, toBaseOffset: 0 },
	{ id: 'minutes', baseUnitId: 'minutes', toBaseFactor: 1, toBaseOffset: 0 },
	{ id: 'hours', baseUnitId: 'minutes', toBaseFactor: 60, toBaseOffset: 0 },
	{ id: 'celsius', baseUnitId: 'celsius', toBaseFactor: 1, toBaseOffset: 0 },
	{
		id: 'fahrenheit',
		baseUnitId: 'celsius',
		toBaseFactor: 0.555555555555556,
		toBaseOffset: -17.7777777777778
	}
];

type AliasSeedGroup = readonly [
	unitId: string,
	locale: string,
	aliases: readonly string[],
	defaultAlias?: string
];

const aliasGroups: readonly AliasSeedGroup[] = [
	['grams', 'en-US', ['g', 'gram', 'grams'], 'g'],
	['kilograms', 'en-US', ['kg', 'kilogram', 'kilograms']],
	['milligrams', 'en-US', ['mg', 'milligram', 'milligrams']],
	['ounces', 'en-US', ['oz', 'oz.', 'ounce', 'ounces']],
	['pounds', 'en-US', ['lb', 'lbs', '#', 'pound', 'pounds']],
	['milliliters', 'en-US', ['ml', 'milliliter', 'milliliters'], 'ml'],
	['liters', 'en-US', ['l', 'liter', 'liters', 'litre', 'litres']],
	['centiliters', 'en-US', ['cl', 'cL', 'centiliter', 'centiliters']],
	['deciliters', 'en-US', ['dl', 'dL', 'deciliter', 'deciliters']],
	['teaspoons', 'en-US', ['tsp', 'tsp.', 't', 't.', 'teaspoon', 'teaspoons']],
	[
		'tablespoons',
		'en-US',
		['tbsp', 'tbsp.', 'T', 'T.', 'tbl', 'tbls', 'tblsp', 'tablespoon', 'tablespoons']
	],
	['cups', 'en-US', ['cup', 'cups', 'c']],
	['fluid_ounces', 'en-US', ['fl oz', 'fl. oz.', 'fl oz.', 'floz', 'fluid ounce', 'fluid ounces']],
	['pints', 'en-US', ['pt', 'pint', 'pints']],
	['quarts', 'en-US', ['qt', 'quart', 'quarts']],
	['gallons', 'en-US', ['gal', 'gallon', 'gallons']],
	['each', 'en-US', ['each', 'ea', 'count'], 'each'],
	['pinches', 'en-US', ['pinch', 'pinches'], 'pinch'],
	['dashes', 'en-US', ['dash', 'dashes'], 'dash'],
	['drops', 'en-US', ['drop', 'drops'], 'drop'],
	['pieces', 'en-US', ['piece', 'pieces'], 'piece'],
	['cloves', 'en-US', ['clove', 'cloves'], 'clove'],
	['slices', 'en-US', ['slice', 'slices'], 'slice'],
	['cans', 'en-US', ['can', 'cans'], 'can'],
	['bunches', 'en-US', ['bunch', 'bunches'], 'bunch'],
	['handfuls', 'en-US', ['handful', 'handfuls'], 'handful'],
	['sprigs', 'en-US', ['sprig', 'sprigs'], 'sprig'],
	['stalks', 'en-US', ['stalk', 'stalks'], 'stalk'],
	['leaves', 'en-US', ['leaf', 'leaves'], 'leaf'],
	['heads', 'en-US', ['head', 'heads'], 'head'],
	['bulbs', 'en-US', ['bulb', 'bulbs'], 'bulb'],
	['jars', 'en-US', ['jar', 'jars'], 'jar'],
	['bottles', 'en-US', ['bottle', 'bottles'], 'bottle'],
	['packages', 'en-US', ['package', 'packages', 'pkg'], 'package'],
	['packets', 'en-US', ['packet', 'packets'], 'packet'],
	['minutes', 'en-US', ['min', 'minute', 'minutes'], 'min'],
	['seconds', 'en-US', ['s', 'sec', 'second', 'seconds']],
	['hours', 'en-US', ['h', 'hr', 'hour', 'hours']],
	['celsius', 'en-US', ['°C', 'celsius', 'C'], '°C'],
	['fahrenheit', 'en-US', ['°F', 'fahrenheit', 'F']],
	['grams', 'nl-NL', ['g', 'gram', 'gr']],
	['kilograms', 'nl-NL', ['kg', 'kilo', 'kilogram']],
	['milliliters', 'nl-NL', ['ml', 'milliliter']],
	['liters', 'nl-NL', ['l', 'liter', 'ltr']],
	['centiliters', 'nl-NL', ['cl']],
	['deciliters', 'nl-NL', ['dl', 'deciliter', 'deciliters']],
	['teaspoons', 'nl-NL', ['tl', 'theelepel', 'theelepels']],
	['tablespoons', 'nl-NL', ['el', 'eetlepel', 'eetlepels']],
	['pinches', 'nl-NL', ['snuf', 'snufje', 'snufjes']],
	['dashes', 'nl-NL', ['scheut', 'scheutje']],
	['pieces', 'nl-NL', ['stuk', 'stuks']],
	['slices', 'nl-NL', ['plak', 'plakken']],
	['cloves', 'nl-NL', ['teen', 'teentje', 'tenen', 'teentjes']],
	['cans', 'nl-NL', ['blik', 'blikken']],
	['bunches', 'nl-NL', ['bos', 'bosje']],
	['handfuls', 'nl-NL', ['handje', 'handjes']],
	['sprigs', 'nl-NL', ['takje', 'takjes']],
	['stalks', 'nl-NL', ['stengel', 'stengels']],
	['leaves', 'nl-NL', ['blaadje', 'blaadjes']],
	['heads', 'nl-NL', ['bol', 'bollen']],
	['bulbs', 'nl-NL', ['bol', 'bollen']],
	['jars', 'nl-NL', ['pot', 'potje', 'potten']],
	['bottles', 'nl-NL', ['fles', 'flessen']],
	['packages', 'nl-NL', ['pak', 'pakken']],
	['packets', 'nl-NL', ['zak', 'zakje', 'zakjes']]
];

const pluralByAlias: Readonly<Record<string, string>> = {
	gram: 'grams',
	kilogram: 'kilograms',
	milliliter: 'milliliters',
	liter: 'liters',
	ounce: 'ounces',
	pound: 'pounds',
	teaspoon: 'teaspoons',
	tablespoon: 'tablespoons',
	cup: 'cups',
	piece: 'pieces',
	clove: 'cloves',
	slice: 'slices',
	can: 'cans',
	bunch: 'bunches',
	handful: 'handfuls',
	sprig: 'sprigs',
	stalk: 'stalks',
	leaf: 'leaves',
	head: 'heads',
	bulb: 'bulbs',
	jar: 'jars',
	bottle: 'bottles',
	package: 'packages',
	packet: 'packets',
	theelepel: 'theelepels',
	eetlepel: 'eetlepels',
	teen: 'tenen',
	teentje: 'teentjes',
	stuk: 'stuks',
	plak: 'plakken',
	bos: 'bossen',
	bosje: 'bosjes',
	snuf: 'snuffen',
	snufje: 'snufjes',
	scheut: 'scheuten',
	scheutje: 'scheutjes',
	takje: 'takjes',
	stengel: 'stengels',
	blaadje: 'blaadjes',
	bol: 'bollen',
	pot: 'potten',
	potje: 'potjes',
	fles: 'flessen',
	pak: 'pakken',
	zak: 'zakken',
	zakje: 'zakjes'
};

const baseByUnit = new Map(GLOBAL_UNIT_SEED.map((unit) => [unit.id, unit.baseUnitId]));
const aliasId = (locale: string, unitId: string, index: number): string =>
	`unit_alias_seed_${locale.toLowerCase().replaceAll('-', '_')}_${unitId}_${index}`;

export const GLOBAL_UNIT_ALIAS_SEED: readonly UnitAlias[] = aliasGroups.flatMap(
	([unitId, locale, aliases, defaultAlias]) =>
		aliases.map((alias, index) => ({
			id: aliasId(locale, unitId, index),
			unitId,
			baseUnitId: baseByUnit.get(unitId) ?? unitId,
			alias,
			pluralAlias: pluralByAlias[alias] ?? null,
			locale,
			sourceDomain: null,
			defaultForLocale: alias === defaultAlias,
			createdAt: seededAt,
			updatedAt: seededAt
		}))
);

export const validateGlobalTaxonomySeed = (): void => {
	const foods = Schema.decodeUnknownSync(Schema.Array(FoodSchema))(GLOBAL_FOOD_SEED);
	const foodAliases = Schema.decodeUnknownSync(Schema.Array(FoodAliasSchema))(
		GLOBAL_FOOD_ALIAS_SEED
	);
	const units = Schema.decodeUnknownSync(Schema.Array(UnitSchema))(GLOBAL_UNIT_SEED);
	const unitAliases = Schema.decodeUnknownSync(Schema.Array(UnitAliasSchema))(
		GLOBAL_UNIT_ALIAS_SEED
	);
	const unitById = new Map(units.map((unit) => [unit.id, unit]));
	if (unitById.size !== units.length) throw new TypeError('Global unit seed IDs must be unique.');
	for (const unit of units) {
		if (!unitById.has(unit.baseUnitId)) {
			throw new TypeError('Every global unit must reference an existing base unit.');
		}
	}
	for (const food of foods) {
		if (unitById.get(food.defaultMeasureUnitId)?.baseUnitId !== food.defaultMeasureBaseUnitId) {
			throw new TypeError('Every global food default measure must reference a valid unit pair.');
		}
	}
	const defaultFoodAliases = new Set<string>();
	for (const alias of foodAliases) {
		if (
			unitById.get(alias.defaultMeasureUnitId ?? '')?.baseUnitId !==
				alias.defaultMeasureBaseUnitId &&
			alias.defaultMeasureUnitId !== null
		) {
			throw new TypeError('Every global food alias measure must reference a valid unit pair.');
		}
		if (alias.defaultForLocale) {
			const key = `${alias.foodId}\u0000${alias.locale}`;
			if (defaultFoodAliases.has(key))
				throw new TypeError('A food can only have one locale default.');
			defaultFoodAliases.add(key);
		}
	}
	const defaultUnitAliases = new Set<string>();
	for (const alias of unitAliases) {
		if (unitById.get(alias.unitId)?.baseUnitId !== alias.baseUnitId) {
			throw new TypeError('Every global unit alias must reference a valid unit pair.');
		}
		if (alias.defaultForLocale) {
			const key = `${alias.baseUnitId}\u0000${alias.locale}`;
			if (defaultUnitAliases.has(key)) {
				throw new TypeError('A unit family can only have one locale default.');
			}
			defaultUnitAliases.add(key);
		}
	}
};

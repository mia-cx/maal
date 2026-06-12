export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'fl oz';
export type UnitPreferences = {
	preferredMassUnit?: MassUnit;
	preferredMassUnitLabel?: string;
	preferredVolumeUnit?: VolumeUnit;
	preferredVolumeUnitLabel?: string;
	ingredientUnitOverrides?: Record<string, string>;
	ingredientUnitLabelOverrides?: Record<string, string>;
	ingredientNameOverrides?: Record<string, string>;
};

export type ParsedIngredientLine = {
	amount: string;
	unit?: string;
	item: string;
};

type UnitKind = 'mass' | 'volume' | 'count';

type UnitDefinition = {
	unit: string;
	kind: UnitKind;
	metricUnit: string;
	toMetric: number;
};

const vulgarFractions: Record<string, number> = {
	'¼': 1 / 4,
	'½': 1 / 2,
	'¾': 3 / 4,
	'⅓': 1 / 3,
	'⅔': 2 / 3,
	'⅛': 1 / 8,
	'⅜': 3 / 8,
	'⅝': 5 / 8,
	'⅞': 7 / 8
};

const fractionLabels = new Map([
	['1/2', '½'],
	['1/3', '⅓'],
	['2/3', '⅔'],
	['1/4', '¼'],
	['3/4', '¾'],
	['1/8', '⅛'],
	['3/8', '⅜'],
	['5/8', '⅝'],
	['7/8', '⅞']
]);

const quantitySource = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])`;
const quantityRangeSource = String.raw`${quantitySource}(?:\s*(?:-|–|—|to)\s*${quantitySource})?`;
const leadingIngredientPattern = new RegExp(
	String.raw`^\s*(${quantityRangeSource})(?:\s+([^\s,()]+))?(?:\s+|$)(.*)$`,
	'u'
);
const scalableNumberPattern = new RegExp(String.raw`([$€£])?(${quantitySource})`, 'gu');

const unitDefinitions: Record<string, UnitDefinition> = {
	bag: { unit: 'bag', kind: 'count', metricUnit: 'bag', toMetric: 1 },
	block: { unit: 'block', kind: 'count', metricUnit: 'block', toMetric: 1 },
	bottle: { unit: 'bottle', kind: 'count', metricUnit: 'bottle', toMetric: 1 },
	box: { unit: 'box', kind: 'count', metricUnit: 'box', toMetric: 1 },
	bunch: { unit: 'bunch', kind: 'count', metricUnit: 'bunch', toMetric: 1 },
	can: { unit: 'can', kind: 'count', metricUnit: 'can', toMetric: 1 },
	clove: { unit: 'clove', kind: 'count', metricUnit: 'clove', toMetric: 1 },
	cup: { unit: 'cup', kind: 'volume', metricUnit: 'ml', toMetric: 236.5882365 },
	dash: { unit: 'dash', kind: 'count', metricUnit: 'dash', toMetric: 1 },
	drop: { unit: 'drop', kind: 'count', metricUnit: 'drop', toMetric: 1 },
	each: { unit: 'each', kind: 'count', metricUnit: 'each', toMetric: 1 },
	'fl oz': { unit: 'fl oz', kind: 'volume', metricUnit: 'ml', toMetric: 29.5735295625 },
	g: { unit: 'g', kind: 'mass', metricUnit: 'g', toMetric: 1 },
	gal: { unit: 'gal', kind: 'volume', metricUnit: 'ml', toMetric: 3785.411784 },
	kg: { unit: 'kg', kind: 'mass', metricUnit: 'g', toMetric: 1000 },
	l: { unit: 'l', kind: 'volume', metricUnit: 'ml', toMetric: 1000 },
	lb: { unit: 'lb', kind: 'mass', metricUnit: 'g', toMetric: 453.59237 },
	mg: { unit: 'mg', kind: 'mass', metricUnit: 'g', toMetric: 0.001 },
	ml: { unit: 'ml', kind: 'volume', metricUnit: 'ml', toMetric: 1 },
	oz: { unit: 'oz', kind: 'mass', metricUnit: 'g', toMetric: 28.349523125 },
	package: { unit: 'package', kind: 'count', metricUnit: 'package', toMetric: 1 },
	packet: { unit: 'packet', kind: 'count', metricUnit: 'packet', toMetric: 1 },
	piece: { unit: 'piece', kind: 'count', metricUnit: 'piece', toMetric: 1 },
	pinch: { unit: 'pinch', kind: 'count', metricUnit: 'pinch', toMetric: 1 },
	pint: { unit: 'pint', kind: 'volume', metricUnit: 'ml', toMetric: 473.176473 },
	quart: { unit: 'quart', kind: 'volume', metricUnit: 'ml', toMetric: 946.352946 },
	slice: { unit: 'slice', kind: 'count', metricUnit: 'slice', toMetric: 1 },
	sprig: { unit: 'sprig', kind: 'count', metricUnit: 'sprig', toMetric: 1 },
	stalk: { unit: 'stalk', kind: 'count', metricUnit: 'stalk', toMetric: 1 },
	stick: { unit: 'stick', kind: 'count', metricUnit: 'stick', toMetric: 1 },
	tbsp: { unit: 'tbsp', kind: 'volume', metricUnit: 'ml', toMetric: 14.78676478125 },
	tsp: { unit: 'tsp', kind: 'volume', metricUnit: 'ml', toMetric: 4.92892159375 }
};

const canonicalUnits = new Map(
	Object.entries({
		bag: 'bag',
		bags: 'bag',
		block: 'block',
		blocks: 'block',
		bottle: 'bottle',
		bottles: 'bottle',
		box: 'box',
		boxes: 'box',
		bunch: 'bunch',
		bunches: 'bunch',
		can: 'can',
		cans: 'can',
		clove: 'clove',
		cloves: 'clove',
		cup: 'cup',
		cups: 'cup',
		c: 'cup',
		dash: 'dash',
		dashes: 'dash',
		drop: 'drop',
		drops: 'drop',
		each: 'each',
		'fl oz': 'fl oz',
		'fluid ounce': 'fl oz',
		'fluid ounces': 'fl oz',
		fluid_ounces: 'fl oz',
		floz: 'fl oz',
		g: 'g',
		gram: 'g',
		grams: 'g',
		gal: 'gal',
		gallon: 'gal',
		gallons: 'gal',
		kg: 'kg',
		kilogram: 'kg',
		kilograms: 'kg',
		l: 'l',
		liter: 'l',
		liters: 'l',
		litre: 'l',
		litres: 'l',
		lb: 'lb',
		lbs: 'lb',
		pound: 'lb',
		pounds: 'lb',
		mg: 'mg',
		milligram: 'mg',
		milligrams: 'mg',
		ml: 'ml',
		milliliter: 'ml',
		milliliters: 'ml',
		millilitre: 'ml',
		millilitres: 'ml',
		oz: 'oz',
		ounce: 'oz',
		ounces: 'oz',
		package: 'package',
		packages: 'package',
		packet: 'packet',
		packets: 'packet',
		piece: 'piece',
		pieces: 'piece',
		pinch: 'pinch',
		pinches: 'pinch',
		pint: 'pint',
		pints: 'pint',
		quart: 'quart',
		quarts: 'quart',
		slice: 'slice',
		slices: 'slice',
		sprig: 'sprig',
		sprigs: 'sprig',
		stalk: 'stalk',
		stalks: 'stalk',
		stick: 'stick',
		sticks: 'stick',
		tablespoon: 'tbsp',
		tablespoons: 'tbsp',
		tbsp: 'tbsp',
		teaspoon: 'tsp',
		teaspoons: 'tsp',
		tsp: 'tsp'
	})
);

const massUnits = new Set(['g', 'kg', 'oz', 'lb']);
const volumeUnits = new Set(['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl oz']);

const normalizedUnit = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[.,]+$/g, '');

const normalizedIngredientKey = (value: string): string =>
	value
		.toLowerCase()
		.replace(/\([^)]*\)/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const unitKind = (unit: string | undefined): UnitKind | undefined => {
	const canonicalUnit = canonicalIngredientUnit(unit);
	if (!canonicalUnit) return;
	return unitDefinitions[canonicalUnit]?.kind;
};

const ingredientOverrideFor = (
	overrides: Record<string, string> | undefined,
	ingredientName?: string,
	ingredientId?: string | null
): string | undefined => {
	if (ingredientId && overrides?.[ingredientId]) return overrides[ingredientId];
	return ingredientName ? overrides?.[normalizedIngredientKey(ingredientName)] : undefined;
};

const preferredUnitFor = (
	unit: string,
	preferences: UnitPreferences,
	ingredientName?: string,
	ingredientId?: string | null
): { unit: string; label?: string } => {
	const kind = unitKind(unit);
	const override = ingredientOverrideFor(
		preferences.ingredientUnitOverrides,
		ingredientName,
		ingredientId
	);
	const labelOverride = ingredientOverrideFor(
		preferences.ingredientUnitLabelOverrides,
		ingredientName,
		ingredientId
	);
	if (kind === 'mass') {
		const target = override === 'oz' ? 'oz' : canonicalIngredientUnit(override);
		const preferred =
			target && massUnits.has(target) ? target : (preferences.preferredMassUnit ?? 'g');
		return { unit: preferred, label: labelOverride ?? preferences.preferredMassUnitLabel };
	}
	if (kind === 'volume') {
		const target = override === 'oz' ? 'fl oz' : canonicalIngredientUnit(override);
		const preferred =
			target && volumeUnits.has(target) ? target : (preferences.preferredVolumeUnit ?? 'ml');
		return { unit: preferred, label: labelOverride ?? preferences.preferredVolumeUnitLabel };
	}
	return { unit };
};

export const canonicalIngredientUnit = (value: string | undefined): string | undefined => {
	if (!value) return;
	return canonicalUnits.get(normalizedUnit(value));
};

export const parseQuantity = (value: string): number | null => {
	const trimmed = value.trim();
	const mixedFraction = /^(\d+)\s+(\d+)\/(\d+)$/.exec(trimmed);
	if (mixedFraction) {
		return Number(mixedFraction[1]) + Number(mixedFraction[2]) / Number(mixedFraction[3]);
	}
	const fraction = /^(\d+)\/(\d+)$/.exec(trimmed);
	if (fraction) return Number(fraction[1]) / Number(fraction[2]);
	const vulgar = trimmed.match(/[¼½¾⅓⅔⅛⅜⅝⅞]/u)?.[0];
	if (vulgar) {
		const whole = Number(trimmed.replace(vulgar, '').trim() || 0);
		return whole + vulgarFractions[vulgar];
	}
	const number = Number(trimmed);
	return Number.isFinite(number) ? number : null;
};

const commonDivisor = (left: number, right: number): number =>
	right === 0 ? left : commonDivisor(right, left % right);

export const formatQuantity = (quantity: number): string => {
	const rounded = Math.round(quantity * 100) / 100;
	const whole = Math.floor(rounded);
	const fraction = rounded - whole;
	if (fraction < 0.01) return String(whole);
	let numerator = Math.round(fraction * 8);
	let denominator = 8;
	const divisor = commonDivisor(numerator, denominator);
	numerator /= divisor;
	denominator /= divisor;
	const label = fractionLabels.get(`${numerator}/${denominator}`) ?? `${numerator}/${denominator}`;
	return whole > 0 ? `${whole}${label.length === 1 ? '' : ' '}${label}` : label;
};

const formatDecimal = (quantity: number): string => {
	const rounded = Math.round(quantity * 100) / 100;
	return Number.isInteger(rounded)
		? String(rounded)
		: rounded.toFixed(2).replace(/0+$/g, '').replace(/\.$/, '');
};

export const parseIngredientLine = (line: string): ParsedIngredientLine => {
	const trimmed = line.trim();
	if (!trimmed) return { amount: '', item: '' };

	const match = leadingIngredientPattern.exec(trimmed);
	if (!match) return { amount: '', item: trimmed };

	const quantity = match[1].trim();
	const candidateUnit = match[2]?.trim();
	const remainder = match[3].trim();
	const unit = canonicalIngredientUnit(candidateUnit);
	if (unit) {
		return { amount: quantity, unit, item: remainder };
	}

	return {
		amount: quantity,
		item: [candidateUnit, remainder].filter(Boolean).join(' ')
	};
};

const toMetricAmount = (quantity: number, unit: string | undefined) => {
	const canonicalUnit = canonicalIngredientUnit(unit);
	if (!canonicalUnit) return { quantity, unit };
	const definition = unitDefinitions[canonicalUnit];
	return {
		quantity: Math.round(quantity * definition.toMetric * 100) / 100,
		unit: definition.metricUnit
	};
};

export const parseIngredientAmount = (amount: string): { quantity?: number; unit?: string } => {
	const match = new RegExp(String.raw`^(${quantitySource})(?:\s+(.+))?$`, 'u').exec(amount.trim());
	if (!match) return {};
	const quantity = parseQuantity(match[1]);
	if (quantity === null) return {};
	return toMetricAmount(quantity, match[2]?.trim());
};

const decimalPlaces = (value: string): number => value.split('.')[1]?.length ?? 0;

const formatScaledNumber = (value: string, scale: number, currency: string | undefined): string => {
	const quantity = parseQuantity(value);
	if (quantity === null) return value;
	const scaled = quantity * scale;
	if (currency) return `${currency}${scaled.toFixed(Math.max(2, decimalPlaces(value)))}`;
	if (value.includes('.')) return String(Math.round(scaled * 100) / 100);
	return formatQuantity(scaled);
};

export const displayIngredientAmount = (
	quantity: number | null | undefined,
	unit: string | null | undefined,
	preferences: UnitPreferences = {},
	ingredientName?: string,
	ingredientId?: string | null
): string => {
	if (quantity === null || quantity === undefined) return '';
	const canonicalUnit = canonicalIngredientUnit(unit ?? undefined) ?? unit ?? '';
	const target = preferredUnitFor(canonicalUnit, preferences, ingredientName, ingredientId);
	if (canonicalUnit === 'g' && massUnits.has(target.unit)) {
		const targetQuantity = quantity / unitDefinitions[target.unit].toMetric;
		return `${formatDecimal(targetQuantity)} ${target.label ?? target.unit}`;
	}
	if (canonicalUnit === 'ml' && volumeUnits.has(target.unit)) {
		const targetQuantity = quantity / unitDefinitions[target.unit].toMetric;
		const label = target.label ?? (target.unit === 'fl oz' ? 'fl oz' : target.unit);
		return `${formatQuantity(targetQuantity)} ${label}`;
	}
	return [formatQuantity(quantity), canonicalUnit].filter(Boolean).join(' ');
};

export const scaleIngredientText = (
	ingredient: string,
	baseServings: number,
	plannedServings: number
) => {
	if (baseServings <= 0 || plannedServings === baseServings) return ingredient;
	const scale = plannedServings / baseServings;
	return ingredient.replace(
		scalableNumberPattern,
		(match, currency: string | undefined, value: string, offset: number) => {
			const previous = ingredient[offset - 1] ?? '';
			const next = ingredient[offset + match.length] ?? '';
			if (/[/\p{L}]/u.test(previous) || next === '/') return match;
			return formatScaledNumber(value, scale, currency);
		}
	);
};

import { TaxonomyInvariantError } from '$lib/domain/contracts/errors.js';

import type { Unit } from './schema.js';

const assertFinite = (value: number, operation: string): void => {
	if (!Number.isFinite(value)) {
		throw new TaxonomyInvariantError({
			operation,
			message: 'The converted quantity must be a finite number.'
		});
	}
};

export const toBaseQuantity = (value: number, unit: Unit): number => {
	assertFinite(value, 'convert quantity to base unit');
	const converted = value * unit.toBaseFactor + unit.toBaseOffset;
	assertFinite(converted, 'convert quantity to base unit');
	return converted;
};

export const fromBaseQuantity = (value: number, unit: Unit): number => {
	assertFinite(value, 'convert quantity from base unit');
	if (unit.toBaseFactor === 0) {
		throw new TaxonomyInvariantError({
			operation: 'convert quantity from base unit',
			message: 'A zero conversion factor cannot be inverted.'
		});
	}
	const converted = (value - unit.toBaseOffset) / unit.toBaseFactor;
	assertFinite(converted, 'convert quantity from base unit');
	return converted;
};

export const convertQuantity = (value: number, from: Unit, to: Unit): number => {
	if (from.baseUnitId !== to.baseUnitId) {
		throw new TaxonomyInvariantError({
			operation: 'convert quantity between units',
			message: 'Units from different base families cannot be converted.'
		});
	}
	return fromBaseQuantity(toBaseQuantity(value, from), to);
};

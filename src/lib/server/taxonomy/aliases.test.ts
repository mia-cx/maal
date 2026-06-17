import { describe, expect, it } from 'vitest';
import {
	aliasPattern,
	bestAliasLookup,
	bestAliasRowsById,
	byLocalePreference,
	localeRank
} from './aliases';

describe('taxonomy alias helpers', () => {
	it('prefers active locale before language and default fallbacks', () => {
		const ranks = localeRank('fr-CA');
		const aliases = bestAliasRowsById(
			[
				{ id: 'grams', locale: 'en-US', alias: 'grams' },
				{ id: 'grams', locale: 'fr', alias: 'grammes' },
				{ id: 'grams', locale: 'fr-CA', alias: 'g canadien' }
			],
			ranks
		);

		expect(aliases.get('grams')?.alias).toBe('g canadien');
	});

	it('keeps the first explicit scope and locale winner for duplicate alias keys', () => {
		const ranks = localeRank('en-US');
		const lookup = bestAliasLookup(
			[
				{ alias: 'C', locale: 'en-US', unitId: 'celsius' },
				{ alias: 'C', locale: 'en-US', unitId: 'cups' }
			],
			ranks,
			(row) => row.unitId
		);

		expect(lookup.get('C')).toBe('celsius');
		expect(lookup.get('c')).toBe('celsius');
	});

	it('preserves caller-provided scope precedence across locale fallbacks', () => {
		const ranks = localeRank('en-US');
		const lookup = bestAliasLookup(
			[
				{ alias: 'C', locale: 'en-US', unitId: 'celsius', scopeRank: 2 },
				{ alias: 'C', locale: 'en', unitId: 'custom_cup', scopeRank: 0 }
			],
			ranks,
			(row) => row.unitId,
			(left, right) => left.scopeRank - right.scopeRank || byLocalePreference(ranks)(left, right)
		);

		expect(lookup.get('C')).toBe('custom_cup');
	});

	it('matches aliases with flexible whitespace', () => {
		const pattern = new RegExp(`^${aliasPattern('degrees C')}$`, 'u');

		expect(pattern.test('degrees C')).toBe(true);
		expect(pattern.test('degrees   C')).toBe(true);
	});
});

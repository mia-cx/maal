import { localeFallbacks } from '$lib/domain/household/settings-parsing';

export const normalizedAlias = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[°º]\s*/gu, '')
		.replace(/\s+/gu, ' ')
		.replace(/[.,]+$/g, '');

export const aliasPattern = (alias: string): string =>
	alias
		.trim()
		.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		.replace(/°/gu, '[°º]')
		.replace(/\s+/gu, '\\s+');

export const localeRank = (locale: string): Map<string, number> =>
	new Map(localeFallbacks(locale).map((value, index) => [value, index]));

export const aliasPreference = (localeRanks: Map<string, number>, locale: string): number =>
	localeRanks.get(locale) ?? 100;

export const bestAliasRowsById = <T extends { id: string; locale: string }>(
	rows: T[],
	localeRanks: Map<string, number>
): Map<string, T> => {
	const result = new Map<string, T>();
	for (const row of rows.toSorted(
		(left, right) =>
			aliasPreference(localeRanks, left.locale) - aliasPreference(localeRanks, right.locale)
	)) {
		if (!result.has(row.id)) result.set(row.id, row);
	}
	return result;
};

export const byLocalePreference =
	<T extends { locale: string }>(localeRanks: Map<string, number>) =>
	(left: T, right: T): number =>
		aliasPreference(localeRanks, left.locale) - aliasPreference(localeRanks, right.locale);

export const bestAliasLookup = <T extends { alias: string; locale: string }, V>(
	rows: T[],
	localeRanks: Map<string, number>,
	value: (row: T) => V,
	compare: (left: T, right: T) => number = byLocalePreference(localeRanks)
): Map<string, V> => {
	const result = new Map<string, V>();
	for (const row of rows.toSorted(compare)) {
		for (const key of [row.alias, normalizedAlias(row.alias)]) {
			if (!result.has(key)) result.set(key, value(row));
		}
	}
	return result;
};

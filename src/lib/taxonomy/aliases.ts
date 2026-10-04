export const normalizedAlias = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[°º]\s*/gu, '')
		.replace(/\s+/gu, ' ')
		.replace(/[.,]+$/g, '');

export const localeFallbacks = (locale: string): string[] => {
	try {
		const parsed = new Intl.Locale(locale);
		return [...new Set([parsed.toString(), parsed.language, 'en-US'])];
	} catch {
		return ['en-US'];
	}
};

export const localeRank = (locale: string): Map<string, number> =>
	new Map(localeFallbacks(locale).map((value, index) => [value, index]));

export const byScopeAndLocale =
	<T extends { locale: string; scopeRank: number }>(ranks: Map<string, number>) =>
	(left: T, right: T): number =>
		left.scopeRank - right.scopeRank ||
		(ranks.get(left.locale) ?? 100) - (ranks.get(right.locale) ?? 100);

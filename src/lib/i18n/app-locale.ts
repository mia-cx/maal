import { locales, type Locale } from '$lib/paraglide/runtime';

const householdLocalePrefixes = [
	'/menu',
	'/plan',
	'/household',
	'/settings',
	'/subscribe',
	'/billing',
	'/export-data',
	'/groceries',
	'/pantry'
] as const;

const languageAliases: Partial<Record<string, Locale>> = {
	da: 'da',
	sv: 'sv',
	nb: 'no',
	nn: 'no'
};

const matchesPathSegment = (pathname: string, prefix: string): boolean =>
	pathname === prefix || pathname.startsWith(`${prefix}/`);

export const authenticatedAppPathUsesHouseholdLocale = (pathname: string): boolean =>
	householdLocalePrefixes.some((prefix) => matchesPathSegment(pathname, prefix));

export const paraglideLocaleFromHouseholdLocale = (
	locale: string | null | undefined
): Locale | null => {
	if (!locale) return null;
	try {
		const language = new Intl.Locale(locale).language;
		const mapped = languageAliases[language] ?? language;
		return locales.includes(mapped as Locale) ? (mapped as Locale) : null;
	} catch {
		return null;
	}
};

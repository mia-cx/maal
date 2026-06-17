import { locales, type Locale } from '$lib/paraglide/runtime';

export const authenticatedAppPathUsesHouseholdLocale = (pathname: string): boolean =>
	pathname.startsWith('/menu') ||
	pathname.startsWith('/plan') ||
	pathname.startsWith('/household') ||
	pathname.startsWith('/settings') ||
	pathname.startsWith('/subscribe') ||
	pathname.startsWith('/billing') ||
	pathname.startsWith('/export-data');

export const paraglideLocaleFromHouseholdLocale = (
	locale: string | null | undefined
): Locale | null => {
	if (!locale) return null;
	try {
		const language = new Intl.Locale(locale).language;
		return locales.includes(language as Locale) ? (language as Locale) : null;
	} catch {
		return null;
	}
};

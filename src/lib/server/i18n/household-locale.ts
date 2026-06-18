import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { paraglideLocaleFromHouseholdLocale } from '$lib/i18n/app-locale';
import { cookieName, type Locale } from '$lib/paraglide/runtime';
import { getDb } from '$lib/server/db';
import { households } from '$lib/server/db/schema';

const localeCookieOptions = (url: URL) => ({
	path: '/',
	httpOnly: false,
	sameSite: 'lax' as const,
	secure: url.protocol === 'https:',
	maxAge: 60 * 60 * 24 * 365
});

export const commitParaglideLocaleCookie = (cookies: Cookies, locale: Locale, url: URL): void => {
	cookies.set(cookieName, locale, localeCookieOptions(url));
};

export const clearParaglideLocaleCookie = (cookies: Cookies, url: URL): void => {
	cookies.delete(cookieName, { ...localeCookieOptions(url), maxAge: undefined });
};

export const loadHouseholdParaglideLocale = async ({
	platform,
	householdId
}: {
	platform: App.Platform | undefined;
	householdId: string | null;
}): Promise<Locale | null> => {
	if (!platform?.env.DB || !householdId) return null;
	try {
		const [row] = await getDb(platform.env.DB)
			.select({ locale: households.locale })
			.from(households)
			.where(eq(households.householdId, householdId))
			.limit(1);
		return paraglideLocaleFromHouseholdLocale(row?.locale);
	} catch (cause) {
		console.error('Failed to load household locale for Paraglide', cause);
		return null;
	}
};

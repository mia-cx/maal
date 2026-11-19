import { baseLocale, locales, localizeHref } from '$lib/paraglide/runtime';

export const canonicalOrigin = 'https://maal.is';
export const publicRouteGroup = '/(public)';

export const isPublicRoute = (id: string | null) =>
	id === publicRouteGroup || Boolean(id?.startsWith(`${publicRouteGroup}/`));

export const alternatesFor = (path: string) => {
	const localized = locales.map((locale) => {
		const href = localizeHref(path, { locale });
		return { locale, href, url: new URL(href, canonicalOrigin).href };
	});
	const href = localizeHref(path, { locale: baseLocale });
	return [
		...localized,
		{ locale: 'x-default', href, url: new URL(href, canonicalOrigin).href }
	] as const;
};

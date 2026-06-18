import { browser } from '$app/environment';
import { authenticatedAppPathUsesHouseholdLocale } from '$lib/i18n/app-locale';
import { baseLocale, getLocale, overwriteGetLocale, type Locale } from '$lib/paraglide/runtime';

const generatedGetLocale = getLocale;
let appLocale: Locale | null = null;
let installed = false;

export const setClientAppLocale = (locale: Locale | null): void => {
	if (!browser) return;
	appLocale = locale;
	if (installed) return;
	installed = true;
	overwriteGetLocale(() => {
		if (!authenticatedAppPathUsesHouseholdLocale(window.location.pathname)) {
			return generatedGetLocale();
		}

		return appLocale ?? baseLocale;
	});
};

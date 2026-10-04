import type { Locale as _Locale } from '$lib/paraglide/runtime';
import type { Pathname } from '$app/types';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';

import {
	baseLocale,
	localizeUrl,
	overwriteGetLocale,
	overwriteSetLocale,
	toLocale
} from '$lib/paraglide/runtime';

const resolvePathname = resolve as unknown as (pathname: Pathname) => string;

export class Locale {
	#current: _Locale = $state(
		toLocale(browser && document.querySelector('html')?.lang) ?? baseLocale
	);

	constructor() {
		overwriteGetLocale(() => this.#current);

		overwriteSetLocale((locale) => {
			this.#current = locale;
			const localizedPath = localizeUrl(page.url.pathname, { locale }).pathname as Pathname;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- this is already a generated localized pathname
			goto(resolvePathname(localizedPath));
		});
	}
}

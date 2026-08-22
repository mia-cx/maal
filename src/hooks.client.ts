import type { ClientInit } from '@sveltejs/kit';

import { clearBrowserDatabasePromises, getBrowserDatabase } from '$lib/client/local/browser.js';
import { readRecoveryState } from '$lib/client/local/recovery.js';
import { startDeviceSync } from '$lib/client/sync/device-coordinator.js';
import { deLocalizeUrl, localizeHref } from '$lib/paraglide/runtime';
import { Locale } from '$lib/paraglide.svelte';

export const init: ClientInit = async () => {
	new Locale();
	if (deLocalizeUrl(new URL(window.location.href)).pathname === '/recovery') return;

	try {
		const database = await getBrowserDatabase();
		const recovery = await readRecoveryState(database);
		if (recovery.state === 'required') {
			database.close();
			throw new TypeError('Local recovery is required.');
		}
		startDeviceSync(database);
	} catch {
		clearBrowserDatabasePromises();
		window.location.replace(localizeHref('/recovery'));
	}
};

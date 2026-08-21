import type { ClientInit } from '@sveltejs/kit';

import { getBrowserDatabase } from '$lib/client/local/browser.js';
import { startDeviceSync } from '$lib/client/sync/device-coordinator.js';
import { Locale } from '$lib/paraglide.svelte';

export const init: ClientInit = async () => {
	new Locale();
	const database = await getBrowserDatabase();
	startDeviceSync(database);
};

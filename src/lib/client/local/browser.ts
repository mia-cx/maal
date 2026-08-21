import { browser } from '$app/environment';

import { MaalDatabase, openMaalDatabase } from './database.js';

let databasePromise: Promise<MaalDatabase> | null = null;

export const browserDatabaseEnvironment = (): string => {
	const configured = import.meta.env.VITE_MAAL_DATABASE_ENVIRONMENT?.trim();
	return configured || import.meta.env.MODE;
};

export const getBrowserDatabase = (): Promise<MaalDatabase> => {
	if (!browser) throw new TypeError('The local Maal database is available only in the browser.');
	databasePromise ??= openMaalDatabase(browserDatabaseEnvironment());
	return databasePromise;
};

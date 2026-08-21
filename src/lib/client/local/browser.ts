import { browser } from '$app/environment';

import type Dexie from 'dexie';

import { MaalDatabase, openMaalDatabase, openRecoveryDatabase } from './database.js';

let databasePromise: Promise<MaalDatabase> | null = null;
let recoveryDatabasePromise: Promise<Dexie> | null = null;

export const browserDatabaseEnvironment = (): string => {
	const configured = import.meta.env.VITE_MAAL_DATABASE_ENVIRONMENT?.trim();
	return configured || import.meta.env.MODE;
};

export const getBrowserDatabase = (): Promise<MaalDatabase> => {
	if (!browser) throw new TypeError('The local Maal database is available only in the browser.');
	databasePromise ??= openMaalDatabase(browserDatabaseEnvironment()).catch((error) => {
		databasePromise = null;
		throw error;
	});
	return databasePromise;
};

export const getBrowserRecoveryDatabase = (): Promise<Dexie> => {
	if (!browser) throw new TypeError('Local recovery is available only in the browser.');
	recoveryDatabasePromise ??= openRecoveryDatabase(browserDatabaseEnvironment()).catch((error) => {
		recoveryDatabasePromise = null;
		throw error;
	});
	return recoveryDatabasePromise;
};

export const clearBrowserDatabasePromises = (): void => {
	databasePromise = null;
	recoveryDatabasePromise = null;
};

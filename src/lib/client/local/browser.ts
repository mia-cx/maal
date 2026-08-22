import { browser } from '$app/environment';

import type Dexie from 'dexie';

import { MaalDatabase, openMaalDatabase, openRecoveryDatabase } from './database.js';

let databasePromise: Promise<MaalDatabase> | null = null;
let recoveryDatabasePromise: Promise<Dexie> | null = null;
const RECOVERY_REQUIRED_KEY_PREFIX = 'maal:recovery-required:';

export const browserDatabaseEnvironment = (): string => {
	const configured = import.meta.env.VITE_MAAL_DATABASE_ENVIRONMENT?.trim();
	return configured || import.meta.env.MODE;
};

const browserRecoveryRequiredKey = (): string =>
	`${RECOVERY_REQUIRED_KEY_PREFIX}${browserDatabaseEnvironment()}`;

export const isBrowserRecoveryRequired = (): boolean => {
	if (!browser) return false;
	try {
		return window.localStorage.getItem(browserRecoveryRequiredKey()) === '1';
	} catch {
		return false;
	}
};

export const markBrowserRecoveryRequired = (): void => {
	if (!browser) return;
	try {
		window.localStorage.setItem(browserRecoveryRequiredKey(), '1');
	} catch {
		// A storage-denied browser still gets the immediate recovery redirect.
	}
};

export const clearBrowserRecoveryRequired = (): void => {
	if (!browser) return;
	try {
		window.localStorage.removeItem(browserRecoveryRequiredKey());
	} catch {
		// Reset/retry can continue when browser storage is unavailable.
	}
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

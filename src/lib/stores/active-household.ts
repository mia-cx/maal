import { persistentAtom } from '@nanostores/persistent';

export const activeHouseholdCookieName = 'maal_household_id';

const storageKey = 'maal:active-household-id:v1';
const householdCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

const normalizeHouseholdId = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() ? value : null;

export const activeHouseholdId = persistentAtom<string | null>(storageKey, null, {
	decode: (encoded) => normalizeHouseholdId(encoded),
	encode: (value) => value ?? ''
});

export const setActiveHouseholdId = (householdId: string | null) => {
	activeHouseholdId.set(normalizeHouseholdId(householdId));
};

export const writeActiveHouseholdCookie = (householdId: string | null) => {
	if (typeof document === 'undefined') return;
	const normalizedHouseholdId = normalizeHouseholdId(householdId);
	if (!normalizedHouseholdId) return;

	document.cookie = [
		`${activeHouseholdCookieName}=${encodeURIComponent(normalizedHouseholdId)}`,
		'path=/',
		`max-age=${householdCookieMaxAgeSeconds}`,
		'samesite=lax',
		location.protocol === 'https:' ? 'secure' : null
	]
		.filter(Boolean)
		.join('; ');
};

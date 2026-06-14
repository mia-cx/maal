import { persistentAtom } from '@nanostores/persistent';

const storageKey = 'maal:active-household-id:v1';

const normalizeHouseholdId = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() ? value : null;

export const activeHouseholdId = persistentAtom<string | null>(storageKey, null, {
	decode: (encoded) => normalizeHouseholdId(encoded),
	encode: (value) => value ?? ''
});

export const setActiveHouseholdId = (householdId: string | null) => {
	activeHouseholdId.set(normalizeHouseholdId(householdId));
};

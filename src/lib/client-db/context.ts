import { atom } from 'nanostores';

export type ClientCacheScope = {
	userId: string;
	householdId: string;
};

export const clientCacheScope = atom<ClientCacheScope | null>(null);

export const setClientCacheScope = (scope: ClientCacheScope | null): void => {
	clientCacheScope.set(scope);
};

export const getClientCacheScope = (): ClientCacheScope | null => clientCacheScope.get();

export const householdIsAccessible = <T extends { id: string }>(
	households: readonly T[],
	householdId: string | null | undefined
): householdId is string =>
	Boolean(householdId && households.some((household) => household.id === householdId));

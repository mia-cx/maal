import { error, type RequestEvent } from '@sveltejs/kit';
import { isAuthSlotId, type AuthSlotId } from '$lib/auth-slots';

export function routeSlotId(event: Pick<RequestEvent, 'params'>): AuthSlotId {
	const slotId = event.params.slot;
	if (!slotId || !isAuthSlotId(slotId)) error(404, 'Auth slot not found');
	return slotId;
}

export function clientAddress(event: Pick<RequestEvent, 'getClientAddress'>) {
	try {
		return event.getClientAddress();
	} catch {
		return undefined;
	}
}

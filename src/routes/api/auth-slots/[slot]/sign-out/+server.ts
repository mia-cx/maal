import { revokeSelectedSession, routeSlotId, taggedErrorResponse } from '$lib/server/auth-slots';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		await revokeSelectedSession(event, routeSlotId(event));
		return new Response(null, { status: 204 });
	} catch (cause) {
		return taggedErrorResponse(cause);
	}
};

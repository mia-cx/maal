import type { RequestHandler } from './$types';

import { handleMcpPost } from '$lib/server/mcp/protocol.js';

export const POST: RequestHandler = ({ request, platform }) => {
	if (!platform?.env.DB) {
		return Response.json({ error: 'mcp_unavailable' }, { status: 503 });
	}
	return handleMcpPost({
		request,
		environment: platform.env
	});
};

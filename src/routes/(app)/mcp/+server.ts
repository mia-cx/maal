import type { RequestHandler } from '@sveltejs/kit';
import { authDiscoveryResponse, bearerToken, handleMcpRequest } from '$lib/server/mcp';

export const POST: RequestHandler = async ({ platform, request }) =>
	handleMcpRequest(platform, request);

export const GET: RequestHandler = async ({ platform, request }) =>
	bearerToken(request) ? handleMcpRequest(platform, request) : authDiscoveryResponse(request);

export const DELETE: RequestHandler = async ({ platform, request }) =>
	handleMcpRequest(platform, request);

export const OPTIONS: RequestHandler = async () => new Response(null, { status: 204 });

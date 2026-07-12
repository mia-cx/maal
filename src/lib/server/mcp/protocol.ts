import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getDb } from '$lib/server/db';
import { verifyMcpKey } from '$lib/server/auth/mcp-keys';
import { type McpContext } from './context';
import { registerToolHandlers } from './registry';
import { tools } from './tools';

export const bearerToken = (request: Request): string | null => {
	const authorization = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(authorization);
	return match?.[1]?.trim() ?? null;
};

const mcpAuthDiscovery = {
	authentication: {
		type: 'bearer',
		scheme: 'Bearer',
		header: 'Authorization',
		format: 'Authorization: Bearer <Maal MCP key>',
		instructions: 'Create a Maal MCP key in Settings → MCP keys, then use it as a bearer token.'
	}
};

const bearerChallenge = 'Bearer realm="Maal MCP", error="invalid_token"';

const jsonResponse = (body: unknown, status: number, headers: HeadersInit = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

export const authDiscoveryResponse = (request: Request) => {
	const body = JSON.stringify(mcpAuthDiscovery);
	if (request.headers.get('accept')?.includes('text/event-stream')) {
		return new Response(`event: auth\ndata: ${body}\n\n`, {
			status: 200,
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-store',
				connection: 'keep-alive'
			}
		});
	}
	return jsonResponse(mcpAuthDiscovery, 200, { 'cache-control': 'no-store' });
};

const unauthorizedResponse = (error: string) =>
	jsonResponse({ error, ...mcpAuthDiscovery }, 401, {
		'www-authenticate': bearerChallenge,
		'cache-control': 'no-store'
	});

const createContext = async (
	platform: App.Platform | undefined,
	request: Request
): Promise<McpContext | Response> => {
	if (!platform?.env.DB) return jsonResponse({ error: 'Database unavailable.' }, 503);
	const token = bearerToken(request);
	if (!token) return unauthorizedResponse('Missing bearer MCP key.');
	try {
		const key = await verifyMcpKey({ platform, rawKey: token });
		if (!key) return unauthorizedResponse('Invalid MCP key.');
		return { platform, key, db: getDb(platform.env.DB) };
	} catch {
		return jsonResponse({ error: 'MCP key storage unavailable.' }, 503);
	}
};

export const handleMcpRequest = async (platform: App.Platform | undefined, request: Request) => {
	const context = await createContext(platform, request);
	if (context instanceof Response) return context;

	const server = new Server({ name: 'maal', version: '0.1.0' }, { capabilities: { tools: {} } });
	registerToolHandlers(server, context, tools);

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});

	try {
		await server.connect(transport);
		return await transport.handleRequest(request);
	} finally {
		await server.close();
	}
};

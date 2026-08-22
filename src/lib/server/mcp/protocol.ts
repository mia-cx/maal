import { Server } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';

import { D1RemoteDomainPort, type RemoteDomainPort } from '$lib/server/domain/remote-port.js';
import { fetchRecipeCandidate } from '$lib/server/recipe-import/parser.js';
import type { RemoteComputeLimiter } from '$lib/server/recipe-import/remote-compute.js';

import {
	authorizeMcpRequest,
	mcpAuthorizationResponse,
	type LiveMembershipProvider
} from './authorization.js';
import type { McpPrincipal } from './contracts.js';
import {
	createMcpHouseholdAdministrationPort,
	type McpHouseholdAdministrationPort
} from './administration.js';
import { registerToolHandlers } from './registry.js';
import { tools } from './tools.js';

export const MCP_ALLOWED_HOSTNAMES = [
	'maal.mia.cx',
	'staging.maal.mia.cx',
	'maal.test',
	'localhost',
	'127.0.0.1'
];

export const createMaalMcpServer = (
	context: Parameters<typeof registerToolHandlers>[1]
): Server => {
	const server = new Server({ name: 'maal', version: '1.0.0' }, { capabilities: { tools: {} } });
	registerToolHandlers(server, context, tools);
	return server;
};

export const createMaalMcpHandler = (input: {
	principal: McpPrincipal;
	domain: RemoteDomainPort;
	limiter: RemoteComputeLimiter;
	administration: McpHouseholdAdministrationPort;
	fetchCandidate?: typeof fetchRecipeCandidate;
	onServerCreated?: (server: Server, era: 'modern' | 'legacy') => void;
}) =>
	createMcpHandler(
		({ era }) => {
			const server = createMaalMcpServer({
				principal: input.principal,
				domain: input.domain,
				limiter: input.limiter,
				fetchRecipeCandidate: input.fetchCandidate ?? fetchRecipeCandidate,
				administration: input.administration
			});
			input.onServerCreated?.(server, era);
			return server;
		},
		{
			route: '/mcp',
			legacy: 'stateless',
			responseMode: 'json',
			corsOptions: false,
			allowedHostnames: MCP_ALLOWED_HOSTNAMES,
			allowedOriginHostnames: ['maal.mia.cx', 'staging.maal.mia.cx', 'maal.test', 'localhost']
		}
	);

export const handleMcpPost = async (input: {
	request: Request;
	environment: Env;
	membershipProvider?: LiveMembershipProvider;
	domain?: RemoteDomainPort;
	limiter?: RemoteComputeLimiter;
	administration?: McpHouseholdAdministrationPort;
	fetchCandidate?: typeof fetchRecipeCandidate;
	onServerCreated?: (server: Server, era: 'modern' | 'legacy') => void;
}): Promise<Response> => {
	let principal;
	try {
		principal = await authorizeMcpRequest({
			request: input.request,
			environment: input.environment,
			...(input.membershipProvider ? { membershipProvider: input.membershipProvider } : {})
		});
	} catch (cause) {
		return mcpAuthorizationResponse(cause);
	}
	const limiter = input.limiter ?? input.environment.RECIPE_URL_RATE_LIMIT;
	if (!limiter) {
		return Response.json(
			{ error: 'remote_compute_unavailable' },
			{ status: 503, headers: { 'cache-control': 'no-store' } }
		);
	}
	const handler = createMaalMcpHandler({
		principal,
		domain: input.domain ?? new D1RemoteDomainPort(input.environment.DB),
		limiter,
		administration:
			input.administration ?? createMcpHouseholdAdministrationPort(principal, input.environment),
		...(input.fetchCandidate ? { fetchCandidate: input.fetchCandidate } : {}),
		...(input.onServerCreated ? { onServerCreated: input.onServerCreated } : {})
	});
	return handler.fetch(input.request);
};

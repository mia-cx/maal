import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { registerToolHandlers, type ToolDefinition } from './registry';
import type { McpContext } from './context';

const context = { platform: undefined, key: {}, db: {} } as McpContext;
const tool = (name: string): ToolDefinition => ({
	name,
	description: name,
	inputSchema: Schema.Struct({}),
	handler: async () => ({ ok: true })
});

type CapturedServer = {
	_requestHandlers: Map<
		string,
		(request: { method: string; params: Record<string, unknown> }) => Promise<unknown>
	>;
};

describe('MCP registry', () => {
	it('rejects duplicate tool names at registration time', () => {
		expect(() =>
			registerToolHandlers(new Server({ name: 'test', version: '0' }), context, [
				tool('x'),
				tool('x')
			])
		).toThrow('Duplicate MCP tool name: x');
	});

	it('returns invalid_input for schema decode failures', async () => {
		const server = new Server({ name: 'test', version: '0' }, { capabilities: { tools: {} } });
		registerToolHandlers(server, context, [
			{
				name: 'plan',
				description: 'plan',
				inputSchema: Schema.Struct({ servingsPlanned: Schema.optional(Schema.Number) }),
				handler: async () => ({ ok: true })
			}
		]);

		const callToolHandler = (server as unknown as CapturedServer)._requestHandlers.get(
			'tools/call'
		);
		expect(callToolHandler).toBeDefined();
		await expect(
			callToolHandler?.({
				method: 'tools/call',
				params: { name: 'plan', arguments: { servingsPlanned: 'many' } }
			})
		).resolves.toMatchObject({
			isError: true,
			structuredContent: { code: 'invalid_input' }
		});
	});
});

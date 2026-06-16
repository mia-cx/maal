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

describe('MCP registry', () => {
	it('rejects duplicate tool names at registration time', () => {
		expect(() => registerToolHandlers(new Server({ name: 'test', version: '0' }), context, [tool('x'), tool('x')])).toThrow(
			'Duplicate MCP tool name: x'
		);
	});
});

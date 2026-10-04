import { Server, type Tool } from '@modelcontextprotocol/server';
import { JSONSchema, Schema } from 'effect';

import type { McpContext } from './context.js';
import { isToolError, toolError, toolResult } from './results.js';
import type { ToolDefinition } from './tools.js';

export const schemaForToolList = (schema: ToolDefinition['inputSchema']): Tool['inputSchema'] => {
	const jsonSchema = JSONSchema.make(schema) as unknown as Record<string, unknown>;
	return (
		jsonSchema.type ? jsonSchema : { type: 'object', properties: {}, additionalProperties: false }
	) as Tool['inputSchema'];
};

export const registerToolHandlers = (
	server: Server,
	context: McpContext,
	definitions: readonly ToolDefinition[]
): void => {
	const byName = new Map<string, ToolDefinition>();
	for (const definition of definitions) {
		if (byName.has(definition.name)) {
			throw new TypeError(`Duplicate MCP tool name: ${definition.name}`);
		}
		byName.set(definition.name, definition);
	}
	server.setRequestHandler('tools/list', async () => ({
		tools: definitions.map((definition) => ({
			name: definition.name,
			description: definition.description,
			inputSchema: schemaForToolList(definition.inputSchema),
			annotations: definition.annotations
		}))
	}));
	server.setRequestHandler('tools/call', async (request) => {
		const definition = byName.get(request.params.name);
		if (!definition) return toolResult(toolError('unknown_tool', 'Unknown tool.'), true);
		let args: Record<string, unknown>;
		try {
			const decoded = Schema.decodeUnknownSync(definition.inputSchema)(
				request.params.arguments ?? {}
			);
			if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
				throw new TypeError('Arguments must be an object.');
			}
			args = decoded as Record<string, unknown>;
		} catch {
			return toolResult(toolError('invalid_input', 'Tool arguments are invalid.'), true);
		}
		try {
			return server.projectCallToolResult(
				toolResult(await definition.handler(context, args)),
				undefined
			);
		} catch (cause) {
			const safe = isToolError(cause)
				? cause
				: toolError(
						cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
							? cause.code
							: 'tool_failed',
						'The tool could not complete this request.'
					);
			return server.projectCallToolResult(toolResult(safe, true), undefined);
		}
	});
};

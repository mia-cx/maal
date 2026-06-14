import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type Tool,
	type ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js';
import * as Schema from 'effect/Schema';
import type { McpContext } from './context';
import type { InputSchema } from './schemas';
import { isRecord } from './scalars';
import { toolError, toolResult } from './results';

export type ToolHandler = (context: McpContext, args: Record<string, unknown>) => Promise<unknown>;

export type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: InputSchema;
	annotations?: ToolAnnotations;
	handler: ToolHandler;
};

export const schemaForToolList = (schema: InputSchema): Tool['inputSchema'] => {
	const jsonSchema = Schema.toJsonSchemaDocument(schema).schema as Record<string, unknown>;
	if (!jsonSchema.type) {
		return { type: 'object', properties: {}, additionalProperties: false };
	}
	return jsonSchema as Tool['inputSchema'];
};

export const registerToolHandlers = (
	server: Server,
	context: McpContext,
	tools: ToolDefinition[]
) => {
	const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: schemaForToolList(tool.inputSchema),
			annotations: tool.annotations
		}))
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = toolMap.get(request.params.name);
		if (!tool) {
			return { isError: true, ...toolResult(toolError('unknown_tool', 'Unknown tool.')) };
		}
		try {
			const args = Schema.decodeUnknownSync(tool.inputSchema)(
				request.params.arguments ?? {}
			) as Record<string, unknown>;
			return toolResult(await tool.handler(context, args));
		} catch (cause) {
			const data =
				isRecord(cause) && typeof cause.code === 'string'
					? cause
					: toolError('tool_failed', cause instanceof Error ? cause.message : 'Tool failed.');
			return { isError: true, ...toolResult(data) };
		}
	});
};

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isRecord } from './scalars';

export const toolError = (code: string, message: string, suggestion?: string) => ({
	code,
	message,
	suggestion
});

export const toolResult = (value: unknown): CallToolResult => {
	const structuredContent = isRecord(value) ? value : { value };
	return {
		content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
		structuredContent
	};
};

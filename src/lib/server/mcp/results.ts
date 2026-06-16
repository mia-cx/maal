import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isRecord } from './scalars';

export const toolError = (code: string, message: string, suggestion?: string) => ({
	code,
	message,
	suggestion
});

export const toolResult = (value: unknown): CallToolResult => {
	const structuredContent = isRecord(value) ? value : { value };
	try {
		const text = JSON.stringify(structuredContent, null, 2);
		if (text) return { content: [{ type: 'text', text }], structuredContent };
	} catch {
		// Fall through to a protocol-safe error result.
	}
	const error = toolError('serialization_failed', 'Tool result could not be serialized.');
	return { content: [{ type: 'text', text: JSON.stringify(error, null, 2) }], structuredContent: error, isError: true };
};

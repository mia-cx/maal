import type { CallToolResult } from '@modelcontextprotocol/server';

export interface ToolError {
	readonly code: string;
	readonly message: string;
	readonly suggestion?: string;
}

export const toolError = (code: string, message: string, suggestion?: string): ToolError => ({
	code,
	message,
	...(suggestion ? { suggestion } : {})
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const toolResult = (value: unknown, isError = false): CallToolResult => {
	const structuredContent = isRecord(value) ? value : { value };
	return {
		content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
		structuredContent,
		...(isError ? { isError: true } : {})
	};
};

export const isToolError = (value: unknown): value is ToolError =>
	isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';

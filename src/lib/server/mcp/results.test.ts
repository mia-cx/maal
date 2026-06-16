import { describe, expect, it } from 'vitest';
import { toolError, toolResult } from './results';

describe('MCP results', () => {
	it('formats record values as structured content and text content', () => {
		expect(toolResult({ ok: true, count: 2 })).toEqual({
			content: [{ type: 'text', text: JSON.stringify({ ok: true, count: 2 }, null, 2) }],
			structuredContent: { ok: true, count: 2 }
		});
	});

	it('wraps scalar values in a value object', () => {
		expect(toolResult('done')).toEqual({
			content: [{ type: 'text', text: JSON.stringify({ value: 'done' }, null, 2) }],
			structuredContent: { value: 'done' }
		});
	});

	it('formats tool errors with optional suggestions', () => {
		expect(toolError('missing_scope', 'Missing scope', 'Reconnect the key')).toEqual({
			code: 'missing_scope',
			message: 'Missing scope',
			suggestion: 'Reconnect the key'
		});
		expect(toolError('missing_scope', 'Missing scope')).toEqual({
			code: 'missing_scope',
			message: 'Missing scope',
			suggestion: undefined
		});
	});
});

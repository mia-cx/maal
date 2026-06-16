import { describe, expect, it } from 'vitest';
import { authDiscoveryResponse, bearerToken } from './protocol';

describe('MCP protocol helpers', () => {
	it('parses bearer tokens case-insensitively', () => {
		expect(
			bearerToken(
				new Request('https://example.com', { headers: { authorization: 'Bearer mk_123' } })
			)
		).toBe('mk_123');
		expect(
			bearerToken(
				new Request('https://example.com', { headers: { authorization: 'bearer  mk_123  ' } })
			)
		).toBe('mk_123');
		expect(bearerToken(new Request('https://example.com'))).toBeNull();
	});

	it('returns JSON auth discovery by default', async () => {
		const response = authDiscoveryResponse(new Request('https://example.com'));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toMatchObject({
			authentication: { type: 'bearer', scheme: 'Bearer' }
		});
	});

	it('returns SSE auth discovery for event-stream requests', async () => {
		const response = authDiscoveryResponse(
			new Request('https://example.com', { headers: { accept: 'text/event-stream' } })
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		expect(await response.text()).toContain('event: auth');
	});
});

import { describe, expect, test } from 'vitest';

import {
	isServiceWorkerCommand,
	isServiceWorkerEvent,
	isUpdateChannelMessage
} from '$lib/pwa/messages.js';

describe('PWA coordination message contracts', () => {
	test('accepts only versioned service-worker activation commands', () => {
		expect(isServiceWorkerCommand({ type: 'SKIP_WAITING', version: 'build-2' })).toBe(true);
		expect(isServiceWorkerCommand({ type: 'GET_VERSION' })).toBe(true);
		expect(isServiceWorkerCommand({ type: 'SKIP_WAITING' })).toBe(false);
		expect(isServiceWorkerCommand({ type: 'DELETE_INDEXED_DB', version: 'build-2' })).toBe(false);
	});

	test('rejects malformed tab and service-worker events', () => {
		expect(
			isUpdateChannelMessage({
				type: 'PREPARE_UPDATE',
				tabId: 'tab-a',
				requestId: 'request-a',
				version: 'build-2',
				critical: false
			})
		).toBe(true);
		expect(
			isUpdateChannelMessage({ type: 'UPDATE_READY', tabId: '', requestId: 'request-a' })
		).toBe(false);
		expect(isServiceWorkerEvent({ type: 'UPDATE_WAITING', version: 'build-2' })).toBe(false);
	});
});

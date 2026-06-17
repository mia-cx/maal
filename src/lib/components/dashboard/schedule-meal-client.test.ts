import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchScheduleMealRange,
	ScheduleMealClientError,
	createScheduleMealRemote
} from './schedule-meal-client';

const mockFetch = (response: Response) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('schedule meal client', () => {
	it('loads meal ranges with URLSearchParams', async () => {
		const fetch = mockFetch(Response.json({ meals: [{ id: 'meal-1', title: 'Dinner' }] }));

		await expect(
			fetchScheduleMealRange({ start: '2026-06-01', end: '2026-06-07' })
		).resolves.toEqual([{ id: 'meal-1', title: 'Dinner' }]);
		expect(fetch).toHaveBeenCalledWith('/plan/meals?start=2026-06-01&end=2026-06-07', {});
	});

	it('throws a typed client error for HTTP failures', async () => {
		mockFetch(new Response('nope', { status: 404 }));

		await expect(
			fetchScheduleMealRange({ start: '2026-06-01', end: '2026-06-07' })
		).rejects.toMatchObject({
			name: 'ScheduleMealClientError',
			status: 404,
			body: 'nope',
			context: 'Load meal range'
		});
	});

	it('rejects invalid response bodies', async () => {
		mockFetch(Response.json({ meal: { id: 'missing-title' } }));

		await expect(createScheduleMealRemote({ id: 'draft', title: 'Dinner' })).rejects.toBeInstanceOf(
			ScheduleMealClientError
		);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';

const activateRequiredHouseholdId = vi.fn();
const resolveRequiredActiveHouseholdId = vi.fn();

vi.mock('$lib/server/http/app-context', () => ({
	activateRequiredHouseholdId,
	resolveRequiredActiveHouseholdId
}));

const { GET, POST } = await import('./+server');

type ActiveHouseholdEvent = Parameters<typeof GET>[0] & Parameters<typeof POST>[0];

const session = createAuthSession();

const cookies: ActiveHouseholdEvent['cookies'] = {
	get: vi.fn(),
	getAll: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
	serialize: vi.fn()
};
const platform = { env: { DB: {} as D1Database } } as App.Platform;
const url = new URL('https://maal.test/api/active-household');

const event = (overrides: Partial<ActiveHouseholdEvent> = {}): ActiveHouseholdEvent =>
	({
		cookies,
		locals: { session },
		platform,
		request: new Request(url, {
			method: 'POST',
			body: JSON.stringify({ householdId: 'household_1' }),
			headers: { 'content-type': 'application/json' }
		}),
		url,
		...overrides
	}) as ActiveHouseholdEvent;

const readJson = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('active-household API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveRequiredActiveHouseholdId.mockResolvedValue('household_1');
		activateRequiredHouseholdId.mockResolvedValue('household_1');
	});

	it('returns the resolved active household', async () => {
		const response = await GET(event());

		expect(response.status).toBe(200);
		await expect(readJson(response)).resolves.toEqual({ householdId: 'household_1' });
		expect(resolveRequiredActiveHouseholdId).toHaveBeenCalledWith({
			platform,
			cookies,
			url,
			session
		});
	});

	it('rejects unauthenticated requests with JSON API status errors', async () => {
		await expect(GET(event({ locals: { session: null } }))).rejects.toMatchObject({
			status: 401,
			body: { message: 'Sign in required.' }
		});
	});

	it('distinguishes users with no households', async () => {
		resolveRequiredActiveHouseholdId.mockRejectedValue(
			Object.assign(new Error('No households available.'), {
				status: 404,
				body: { message: 'No households available.' }
			})
		);

		await expect(GET(event())).rejects.toMatchObject({
			status: 404,
			body: { message: 'No households available.' }
		});
	});

	it('logs malformed JSON while returning a generic client error', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(
			POST(
				event({
					request: new Request(url, {
						method: 'POST',
						body: '{',
						headers: { 'content-type': 'application/json' }
					})
				})
			)
		).rejects.toMatchObject({
			status: 400,
			body: { message: 'Invalid request.' }
		});
		expect(warn).toHaveBeenCalledWith(
			'Invalid active-household request body',
			expect.any(SyntaxError)
		);
		warn.mockRestore();
	});

	it('rejects inaccessible household activation', async () => {
		activateRequiredHouseholdId.mockRejectedValue(
			Object.assign(new Error('Household is not accessible.'), {
				status: 403,
				body: { message: 'Household is not accessible.' }
			})
		);

		await expect(
			POST(
				event({
					request: new Request(url, {
						method: 'POST',
						body: JSON.stringify({ householdId: ' household_2 ' }),
						headers: { 'content-type': 'application/json' }
					})
				})
			)
		).rejects.toMatchObject({
			status: 403,
			body: { message: 'Household is not accessible.' }
		});
		expect(activateRequiredHouseholdId).toHaveBeenCalledWith({
			platform,
			cookies,
			url,
			session,
			householdId: 'household_2'
		});
	});

	it('activates accessible households', async () => {
		const response = await POST(event());

		expect(response.status).toBe(200);
		await expect(readJson(response)).resolves.toEqual({ householdId: 'household_1' });
	});
});

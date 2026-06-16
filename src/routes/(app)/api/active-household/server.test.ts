import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '$lib/server/auth/session';

const activateRequestedHouseholdId = vi.fn();
const resolveActiveHouseholdId = vi.fn();

vi.mock('$lib/server/auth/household', () => ({
	activateRequestedHouseholdId,
	resolveActiveHouseholdId
}));

const { GET, POST } = await import('./+server');

type ActiveHouseholdEvent = Parameters<typeof GET>[0] & Parameters<typeof POST>[0];

const session: AuthSession = {
	user: {
		id: 'user_1',
		email: 'user@maal.test',
		name: null,
		firstName: null,
		lastName: null,
		profilePictureUrl: null,
		emailVerified: true,
		metadata: {}
	},
	sessionId: 'session_1',
	organizationId: null,
	role: null,
	roles: [],
	permissions: [],
	entitlements: [],
	featureFlags: []
};

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
		resolveActiveHouseholdId.mockResolvedValue({
			householdId: 'household_1',
			hasAnyHousehold: true
		});
		activateRequestedHouseholdId.mockResolvedValue({
			status: 'activated',
			householdId: 'household_1',
			hasAnyHousehold: true
		});
	});

	it('returns the resolved active household', async () => {
		const response = await GET(event());

		expect(response.status).toBe(200);
		await expect(readJson(response)).resolves.toEqual({ householdId: 'household_1' });
		expect(resolveActiveHouseholdId).toHaveBeenCalledWith({
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
		resolveActiveHouseholdId.mockResolvedValue({ householdId: null, hasAnyHousehold: false });

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
		activateRequestedHouseholdId.mockResolvedValue({
			status: 'inaccessible',
			householdId: 'household_2',
			hasAnyHousehold: true
		});

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
		expect(activateRequestedHouseholdId).toHaveBeenCalledWith({
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

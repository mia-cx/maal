import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';

const mocks = vi.hoisted(() => ({
	createHouseholdForUser: vi.fn(),
	loadTrialAvailability: vi.fn(),
	startHouseholdTrial: vi.fn()
}));

vi.mock('$lib/server/auth/household', () => ({
	createHouseholdForUser: mocks.createHouseholdForUser
}));
vi.mock('$lib/server/domains/billing', () => ({
	loadTrialAvailability: mocks.loadTrialAvailability,
	startHouseholdTrial: mocks.startHouseholdTrial
}));

const { POST } = await import('./+server');

type OnboardingEvent = Parameters<typeof POST>[0];

const session = createAuthSession();
const event = (body: unknown): OnboardingEvent =>
	({
		cookies: {},
		locals: { session },
		platform: { env: { DB: {} as D1Database } } as App.Platform,
		request: new Request('https://maal.test/household/onboarding', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		url: new URL('https://maal.test/household/onboarding')
	}) as OnboardingEvent;

const readJson = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('household onboarding POST', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createHouseholdForUser.mockResolvedValue({ id: 'household_1', name: 'Kitchen' });
		mocks.loadTrialAvailability.mockResolvedValue({ available: true });
	});

	it('keeps household creation successful when trial startup fails', async () => {
		mocks.startHouseholdTrial.mockRejectedValue(new Error('Stripe unavailable'));

		const response = await POST(event({ name: 'Kitchen' }));

		expect(response.status).toBe(201);
		await expect(readJson(response)).resolves.toEqual({
			household: { id: 'household_1', name: 'Kitchen' },
			trialStarted: false
		});
		expect(mocks.createHouseholdForUser).toHaveBeenCalledTimes(1);
		expect(mocks.startHouseholdTrial).toHaveBeenCalledTimes(1);
	});
});

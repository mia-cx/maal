import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '$lib/server/auth/session';

const resolveActiveHouseholdId = vi.fn();
const requireHouseholdAccess = vi.fn();

vi.mock('$lib/server/auth/household', () => ({ resolveActiveHouseholdId }));
vi.mock('$lib/server/domains/billing', () => ({ requireHouseholdAccess }));

const { requireAppContext } = await import('./app-context');

const session = { user: { id: 'user_1' } } as AuthSession;
const database = {} as D1Database;
const cookies = {} as Parameters<typeof requireAppContext>[0]['cookies'];
const url = new URL('https://maal.test/plan/meals');

const input = (overrides: Partial<Parameters<typeof requireAppContext>[0]> = {}) => ({
	cookies,
	locals: { session },
	platform: { env: { DB: database } } as unknown as App.Platform,
	url,
	...overrides
});

describe('requireAppContext', () => {
	beforeEach(() => {
		resolveActiveHouseholdId.mockResolvedValue({ householdId: 'household_1' });
		requireHouseholdAccess.mockResolvedValue(undefined);
	});

	it('rejects unauthenticated requests', async () => {
		await expect(requireAppContext(input({ locals: { session: null } }))).rejects.toMatchObject({
			status: 401,
			body: { message: 'Sign in required.' }
		});
	});

	it('rejects requests without a database binding', async () => {
		await expect(
			requireAppContext(input({ platform: { env: {} } as App.Platform }))
		).rejects.toMatchObject({
			status: 503,
			body: { message: 'Database unavailable.' }
		});
	});

	it('rejects requests without an active household', async () => {
		resolveActiveHouseholdId.mockResolvedValue({ householdId: null });

		await expect(requireAppContext(input())).rejects.toMatchObject({
			status: 400,
			body: { message: 'Household is required.' }
		});
	});

	it('propagates billing access denial', async () => {
		requireHouseholdAccess.mockRejectedValue(
			Object.assign(new Error('Payment required.'), {
				status: 402,
				body: { message: 'Payment required.' }
			})
		);

		await expect(requireAppContext(input())).rejects.toMatchObject({
			status: 402,
			body: { message: 'Payment required.' }
		});
	});

	it('returns the authenticated context', async () => {
		const context = await requireAppContext(input());

		expect(context.session).toBe(session);
		expect(context.householdId).toBe('household_1');
		expect(context.database).toBe(database);
		expect(context.db).toBeDefined();
		expect(requireHouseholdAccess).toHaveBeenCalledWith({
			platform: input().platform,
			householdId: 'household_1'
		});
	});
});

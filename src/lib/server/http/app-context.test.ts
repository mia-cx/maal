import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';
import type { AppContextInput } from './app-context';

const resolveActiveHouseholdId = vi.fn();
const requireHouseholdAccess = vi.fn();

vi.mock('$lib/server/auth/household', () => ({ resolveActiveHouseholdId }));
vi.mock('$lib/server/domains/billing', () => ({ requireHouseholdAccess }));

const {
	requireActivatedHousehold,
	requireAppContext,
	requireBillingAppContext,
	requireResolvedHouseholdId
} = await import('./app-context');

const session = createAuthSession();
const database = {} as D1Database;
const cookies: AppContextInput['cookies'] = {
	get: vi.fn(),
	getAll: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
	serialize: vi.fn()
};
const url = new URL('https://maal.test/plan/meals');
const platform = { env: { DB: database } } as App.Platform;

const input = (overrides: Partial<AppContextInput> = {}): AppContextInput => ({
	cookies,
	locals: { session },
	platform,
	url,
	...overrides
});

describe('requireResolvedHouseholdId', () => {
	it('returns a resolved household id', () => {
		expect(requireResolvedHouseholdId({ householdId: 'household_1', hasAnyHousehold: true })).toBe(
			'household_1'
		);
	});

	it('rejects users with no households', () => {
		expect(() => requireResolvedHouseholdId({ householdId: null, hasAnyHousehold: false })).toThrow(
			expect.objectContaining({ status: 404, body: { message: 'No households available.' } })
		);
	});

	it('rejects unresolved active households', () => {
		expect(() => requireResolvedHouseholdId({ householdId: null, hasAnyHousehold: true })).toThrow(
			expect.objectContaining({ status: 400, body: { message: 'Household is required.' } })
		);
	});
});

describe('requireActivatedHousehold', () => {
	it('returns an activated household id', () => {
		expect(
			requireActivatedHousehold({
				status: 'activated',
				householdId: 'household_1',
				hasAnyHousehold: true
			})
		).toBe('household_1');
	});

	it('rejects inaccessible households when the user has none', () => {
		expect(() =>
			requireActivatedHousehold({
				status: 'inaccessible',
				householdId: 'household_2',
				hasAnyHousehold: false
			})
		).toThrow(
			expect.objectContaining({ status: 404, body: { message: 'No households available.' } })
		);
	});

	it('rejects inaccessible households when the user has others', () => {
		expect(() =>
			requireActivatedHousehold({
				status: 'inaccessible',
				householdId: 'household_2',
				hasAnyHousehold: true
			})
		).toThrow(
			expect.objectContaining({ status: 403, body: { message: 'Household is not accessible.' } })
		);
	});
});

describe('requireAppContext', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveActiveHouseholdId.mockResolvedValue({
			householdId: 'household_1',
			hasAnyHousehold: true
		});
		requireHouseholdAccess.mockResolvedValue(undefined);
	});

	it('rejects unauthenticated requests', async () => {
		await expect(requireAppContext(input({ locals: { session: null } }))).rejects.toMatchObject({
			status: 401,
			body: { message: 'Sign in required.' }
		});
		expect(resolveActiveHouseholdId).not.toHaveBeenCalled();
		expect(requireHouseholdAccess).not.toHaveBeenCalled();
	});

	it('rejects requests without a database binding', async () => {
		await expect(
			requireAppContext(input({ platform: { env: {} } as App.Platform }))
		).rejects.toMatchObject({
			status: 503,
			body: { message: 'Database unavailable.' }
		});
		expect(resolveActiveHouseholdId).not.toHaveBeenCalled();
		expect(requireHouseholdAccess).not.toHaveBeenCalled();
	});

	it('rejects requests without an active household', async () => {
		resolveActiveHouseholdId.mockResolvedValue({ householdId: null, hasAnyHousehold: true });

		await expect(requireAppContext(input())).rejects.toMatchObject({
			status: 400,
			body: { message: 'Household is required.' }
		});
		expect(resolveActiveHouseholdId).toHaveBeenCalledTimes(1);
		expect(requireHouseholdAccess).not.toHaveBeenCalled();
	});

	it('rejects requests when the user has no households', async () => {
		resolveActiveHouseholdId.mockResolvedValue({ householdId: null, hasAnyHousehold: false });

		await expect(requireAppContext(input())).rejects.toMatchObject({
			status: 404,
			body: { message: 'No households available.' }
		});
		expect(resolveActiveHouseholdId).toHaveBeenCalledTimes(1);
		expect(requireHouseholdAccess).not.toHaveBeenCalled();
	});

	it('maps household dependency failures to a service error', async () => {
		resolveActiveHouseholdId.mockRejectedValue(new Error('WorkOS unavailable'));

		await expect(requireAppContext(input())).rejects.toMatchObject({
			status: 503,
			body: { message: 'Household service unavailable.' }
		});
		expect(requireHouseholdAccess).not.toHaveBeenCalled();
	});

	it('returns the authenticated context without billing access checks', async () => {
		const context = await requireAppContext(input());

		expect(context.session).toBe(session);
		expect(context.householdId).toBe('household_1');
		expect(context.database).toBe(database);
		expect(context.db).toBeDefined();
		expect(requireHouseholdAccess).not.toHaveBeenCalled();
	});
});

describe('requireBillingAppContext', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveActiveHouseholdId.mockResolvedValue({
			householdId: 'household_1',
			hasAnyHousehold: true
		});
		requireHouseholdAccess.mockResolvedValue(undefined);
	});

	it('propagates billing access denial', async () => {
		requireHouseholdAccess.mockRejectedValue(
			Object.assign(new Error('Payment required.'), {
				status: 402,
				body: { message: 'Payment required.' }
			})
		);

		await expect(requireBillingAppContext(input())).rejects.toMatchObject({
			status: 402,
			body: { message: 'Payment required.' }
		});
	});

	it('returns the authenticated context after checking billing access', async () => {
		const context = await requireBillingAppContext(input());

		expect(context.session).toBe(session);
		expect(context.householdId).toBe('household_1');
		expect(context.database).toBe(database);
		expect(context.db).toBeDefined();
		expect(requireHouseholdAccess).toHaveBeenCalledTimes(1);
		expect(requireHouseholdAccess).toHaveBeenCalledWith({
			platform,
			householdId: 'household_1'
		});
	});
});

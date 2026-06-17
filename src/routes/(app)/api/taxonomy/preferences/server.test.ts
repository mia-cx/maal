import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';

const requireAppContext = vi.fn();
const loadHouseholdTaxonomyPreferences = vi.fn();

vi.mock('$lib/server/http/app-context', () => ({ requireAppContext }));
vi.mock('$lib/server/taxonomy/household-preferences', () => ({
	loadHouseholdTaxonomyPreferences
}));

const { GET } = await import('./+server');

type TaxonomyPreferencesEvent = Parameters<typeof GET>[0];

const session = createAuthSession();

const cookies: TaxonomyPreferencesEvent['cookies'] = {
	get: vi.fn(),
	getAll: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
	serialize: vi.fn()
};
const platform = { env: { DB: {} as D1Database } } as App.Platform;
const db = {};

const url = new URL('https://maal.test/api/taxonomy/preferences');

const event = (overrides: Partial<TaxonomyPreferencesEvent> = {}): TaxonomyPreferencesEvent =>
	({
		cookies,
		locals: { session },
		platform,
		url,
		...overrides
	}) as TaxonomyPreferencesEvent;

const readJson = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('taxonomy preferences API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireAppContext.mockResolvedValue({
			db,
			householdId: 'household_1',
			session
		});
		loadHouseholdTaxonomyPreferences.mockResolvedValue({
			locale: 'nl-NL',
			diets: ['vegetarian']
		});
	});

	it('loads preferences through the shared app context', async () => {
		const response = await GET(event());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, max-age=60');
		await expect(readJson(response)).resolves.toEqual({
			locale: 'nl-NL',
			diets: ['vegetarian']
		});
		expect(requireAppContext).toHaveBeenCalledWith({
			cookies,
			locals: { session },
			platform,
			url
		});
		expect(loadHouseholdTaxonomyPreferences).toHaveBeenCalledWith(db, {
			workosUserId: 'user_1',
			householdId: 'household_1',
			locale: null
		});
	});

	it('allows the request locale to override the household locale', async () => {
		const requestUrl = new URL('https://maal.test/api/taxonomy/preferences?locale=en-GB');
		await GET(event({ url: requestUrl }));

		expect(loadHouseholdTaxonomyPreferences).toHaveBeenCalledWith(db, {
			workosUserId: 'user_1',
			householdId: 'household_1',
			locale: 'en-GB'
		});
	});

	it('maps preference dependency failures to a JSON service error', async () => {
		loadHouseholdTaxonomyPreferences.mockRejectedValue(new Error('taxonomy offline'));

		await expect(GET(event())).rejects.toMatchObject({
			status: 503,
			body: { message: 'Taxonomy preferences unavailable.' }
		});
	});
});

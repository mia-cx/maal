import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';
import {
	joinHouseholdFromInvite,
	loadHouseholdInviteByCode,
	type HouseholdInvite
} from '$lib/server/auth/household-invites';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/server/auth/household-invites', () => ({
	joinHouseholdFromInvite: vi.fn(),
	loadHouseholdInviteByCode: vi.fn()
}));

const db = {} as D1Database;
const platform = { env: { DB: db } } as App.Platform;
const url = new URL('https://maal.test/invite/abc?from=email');
const invite = {
	id: 'invite_1',
	householdId: 'household_<script>',
	code: 'abc',
	createdByUserId: 'user_owner',
	roleSlug: 'member',
	maxUses: null,
	usesCount: 0,
	expiresAt: null,
	revokedAt: null,
	createdAt: '2026-06-17T00:00:00.000Z',
	updatedAt: '2026-06-17T00:00:00.000Z'
} satisfies HouseholdInvite;

const event = (overrides: Partial<Parameters<typeof GET>[0]> = {}) =>
	({
		cookies: {},
		locals: { session: { user: { id: 'user_1' } } },
		platform,
		url,
		params: { code: ' abc ' },
		...overrides
	}) as Parameters<typeof GET>[0];

describe('/invite/[code]', () => {
	beforeEach(() => {
		vi.mocked(loadHouseholdInviteByCode).mockReset().mockResolvedValue(invite);
		vi.mocked(joinHouseholdFromInvite).mockReset().mockResolvedValue('household_1');
	});

	it('previews an invite on GET without accepting it', async () => {
		const response = await GET(event());

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(await response.text()).toContain('household_&lt;script&gt;');
		expect(loadHouseholdInviteByCode).toHaveBeenCalledWith(db, 'abc');
		expect(joinHouseholdFromInvite).not.toHaveBeenCalled();
	});

	it('reports unavailable invite storage without reading platform.env.DB unsafely', async () => {
		await expect(
			GET(event({ platform: { env: undefined } as App.Platform }))
		).rejects.toMatchObject({
			status: 503,
			body: { message: 'Invite storage is not available.' }
		});
		expect(loadHouseholdInviteByCode).not.toHaveBeenCalled();
	});

	it('accepts an invite on POST only', async () => {
		await expect(POST(event())).rejects.toMatchObject({ status: 303, location: '/plan?joined=1' });

		expect(joinHouseholdFromInvite).toHaveBeenCalledWith({
			platform,
			cookies: {},
			url,
			code: 'abc',
			userId: 'user_1'
		});
	});
});

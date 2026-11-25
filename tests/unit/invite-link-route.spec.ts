import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { GET } from '../../src/routes/invite/[code]/+server.js';

const open = async (code: string): Promise<unknown> => {
	try {
		return await GET({ params: { code } } as Parameters<typeof GET>[0]);
	} catch (thrown) {
		return thrown;
	}
};

describe('shared invite link', () => {
	it('opens household onboarding with the normalized code filled in', async () => {
		const outcome = await open('7kq2-mz4h-xp9a');
		expect(isRedirect(outcome) && outcome).toMatchObject({
			status: 303,
			location: '/household?join=7KQ2MZ4HXP9A'
		});
	});

	it('refuses a code that cannot be an invite', async () => {
		const outcome = await open('not-a-code');
		expect(isHttpError(outcome) && outcome.status).toBe(404);
	});
});

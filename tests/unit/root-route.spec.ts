import { isRedirect } from '@sveltejs/kit';
import { expect, it } from 'vitest';

import { load } from '../../src/routes/+page.js';

it('opens the meal plan with a sign-in callback marker still attached', () => {
	let outcome: unknown;
	try {
		load({
			url: new URL(
				'https://maal.test/?authSlot=00112233445566778899aabbccddeeff&authStatus=authenticated'
			)
		} as Parameters<typeof load>[0]);
	} catch (thrown) {
		outcome = thrown;
	}
	expect(isRedirect(outcome) && outcome).toMatchObject({
		status: 307,
		location: '/plan?authSlot=00112233445566778899aabbccddeeff&authStatus=authenticated'
	});
});

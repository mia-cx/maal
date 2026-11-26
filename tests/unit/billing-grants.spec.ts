import { describe, expect, test } from 'vitest';

import { workosMetadataGrantsHousehold } from '$lib/domain/billing/grants.js';

describe('WorkOS metadata grants', () => {
	test.each([
		['an organization grant token', {}, { maal_grant: 'beta' }, 'org_a', true],
		['an organization lifetime key with any value', {}, { lifetime_grant: 'yes' }, 'org_a', true],
		['a user grant in every household', { maal_entitlement: 'maal:employee' }, {}, 'org_b', true],
		[
			'a scoped user grant in its household',
			{ maal_grant: 'beta household:org_a' },
			{},
			'org_a',
			true
		],
		['a scoped user grant elsewhere', { maal_grant: 'beta household:org_a' }, {}, 'org_b', false],
		['a bare household scope', { maal_grants: 'maal:household:org_a' }, {}, 'org_a', true],
		['a list split by commas', { maal_grants: 'reward, household:org_b' }, {}, 'org_b', true],
		['an unknown token', { maal_grant: 'gold' }, { maal_grant: 'gold' }, 'org_a', false],
		['metadata under another key', { plan: 'lifetime' }, { tier: 'free' }, 'org_a', false],
		['no metadata', {}, {}, 'org_a', false]
	])('%s', (_, userMetadata, organizationMetadata, householdId, expected) => {
		expect(workosMetadataGrantsHousehold({ householdId, userMetadata, organizationMetadata })).toBe(
			expected
		);
	});
});

import { error } from '@sveltejs/kit';
import { getPolicy, getPolicyVersion } from '$lib/legal/policies';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const policy = getPolicy(params.policy);
	const document = getPolicyVersion(params.policy, params.version);
	if (!policy || !document) error(404, 'Legal policy version not found');

	return {
		document,
		archiveHref: `/legal/${policy.slug}/archive`,
		currentHref: `/legal/${policy.slug}`
	};
};

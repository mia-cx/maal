import { error } from '@sveltejs/kit';
import { getPolicy } from '$lib/legal/policies';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const policy = getPolicy(params.policy);
	if (!policy) error(404, 'Legal policy not found');

	return {
		document: policy.current,
		archiveHref: `/legal/${policy.slug}/archive`
	};
};

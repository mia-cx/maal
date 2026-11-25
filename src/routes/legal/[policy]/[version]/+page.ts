import { error } from '@sveltejs/kit';
import { getPolicyVersion } from '$lib/legal/policies';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const document = getPolicyVersion(params.policy, params.version);
	if (!document) error(404, 'Legal policy version not found');
	return { document };
};

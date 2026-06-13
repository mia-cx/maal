import { policyList } from '$lib/legal/policies';
import type { PageLoad } from './$types';

export const load: PageLoad = () => ({ policies: policyList });

import { error } from '@sveltejs/kit';
import { hasHouseholdAccess } from './entitlements';

export const requireHouseholdAccess = async (input: {
	platform?: App.Platform;
	householdId: string;
}): Promise<void> => {
	if (await hasHouseholdAccess({ platform: input.platform, householdId: input.householdId }))
		return;
	error(402, { message: 'An active Maal plan is required for this household.' });
};

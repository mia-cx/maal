import { handleHouseholdAdministrationRequest } from '$lib/server/household-administration/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	handleHouseholdAdministrationRequest(event, 'createHousehold');
